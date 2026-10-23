import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const processorUrl = process.env.CLIP_PROCESSOR_URL;
const processorKey = process.env.CLIP_PROCESSOR_API_KEY;
for (const [name, value] of [["NEXT_PUBLIC_SUPABASE_URL", url], ["SUPABASE_SERVICE_ROLE_KEY", serviceKey], ["CLIP_PROCESSOR_URL", processorUrl], ["CLIP_PROCESSOR_API_KEY", processorKey]]) {
  if (!value) throw new Error("Missing required worker setting: " + name);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const pollMs = Number(process.env.WORKER_POLL_MS || 5000);
const workerName = process.env.WORKER_NAME || "aura-worker";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

while (true) {
  const { data: claimed, error } = await supabase.rpc("claim_next_clip_job", { p_worker_name: workerName });
  if (error) {
    console.error("Queue claim failed:", error.message);
    await sleep(pollMs);
    continue;
  }
  const job = Array.isArray(claimed) ? claimed[0] : null;
  if (!job) { await sleep(pollMs); continue; }
  await processJob(job);
}

async function processJob(job) {
  try {
    let sourceUrl = job.source_url;
    if (job.storage_path) {
      const { data, error } = await supabase.storage.from("source-videos").createSignedUrl(job.storage_path, 3600);
      if (error || !data?.signedUrl) throw new Error("Could not sign the source video URL.");
      sourceUrl = data.signedUrl;
    }
    if (!sourceUrl) throw new Error("The video has no readable source.");

    const outputUploads = [];
    const outputPaths = [];
    for (let i = 1; i <= 15; i++) {
      const path = job.owner_id + "/" + job.job_id + "/clip-" + String(i).padStart(3, "0") + ".mp4";
      const { data, error } = await supabase.storage.from("clip-exports").createSignedUploadUrl(path);
      if (error || !data?.token) throw new Error("Could not prepare private clip output storage.");
      outputUploads.push({ index: i, path, token: data.token });
      outputPaths.push(path);
    }

    const response = await fetch(processorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + processorKey },
      body: JSON.stringify({
        jobId: job.job_id, videoId: job.video_id, sourceUrl,
        outputBucket: "clip-exports",
        outputPathPrefix: job.owner_id + "/" + job.job_id + "/",
        outputUploads,
      }),
      signal: AbortSignal.timeout(45 * 60 * 1000),
    });
    if (!response.ok) throw new Error("Clip processor returned HTTP " + response.status + ".");
    const payload = await response.json();
    if (!Array.isArray(payload.clips) || payload.clips.length < 1 || payload.clips.length > 15) {
      throw new Error("Clip processor response must contain between 1 and 15 clips.");
    }

    const rows = payload.clips.map((clip, index) => {
      const outputIndex = Number(clip.output_index);
      const outputPath = outputPaths[outputIndex - 1];
      const start = Number(clip.start_seconds);
      const end = Number(clip.end_seconds);
      const score = clip.virality_score == null ? null : Number(clip.virality_score);
      if (!outputPath || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw new Error("Clip processor returned invalid clip metadata.");
      }
      if (score != null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new Error("Clip processor returned an invalid score.");
      return {
        owner_id: job.owner_id, video_id: job.video_id, job_id: job.job_id,
        title: String(clip.title || ("Clip " + (index + 1))).slice(0, 180),
        start_seconds: start, end_seconds: end, virality_score: score,
        transcript: clip.transcript ? String(clip.transcript).slice(0, 12000) : null,
        output_path: outputPath,
      };
    });
    if (new Set(rows.map(row => row.output_path)).size !== rows.length) throw new Error("Clip processor reused an output slot.");

    for (const row of rows) {
      const slash = row.output_path.lastIndexOf("/");
      const folder = row.output_path.slice(0, slash);
      const filename = row.output_path.slice(slash + 1);
      const { data: objects, error } = await supabase.storage.from("clip-exports").list(folder, { search: filename, limit: 10 });
      if (error || !objects?.some(object => object.name === filename)) {
        throw new Error("The processor did not upload every generated clip.");
      }
    }

    const { error: insertError } = await supabase.from("clips").insert(rows);
    if (insertError) throw insertError;
    await supabase.from("clip_jobs").update({ status: "completed", progress: 100, error: null }).eq("id", job.job_id);
    await supabase.from("videos").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", job.video_id);
    console.log("Completed job", job.job_id, "with", rows.length, "clips");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error.";
    await supabase.from("clip_jobs").update({ status: "failed", error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", job.job_id);
    await supabase.from("videos").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", job.video_id);
    console.error("Job failed", job.job_id, message);
  }
}
