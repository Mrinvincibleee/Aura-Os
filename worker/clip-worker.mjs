import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const processorUrl = process.env.CLIP_PROCESSOR_URL;
const processorKey = process.env.CLIP_PROCESSOR_API_KEY;
for (const [name, value] of [["NEXT_PUBLIC_SUPABASE_URL", url], ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey], ["SUPABASE_SERVICE_ROLE_KEY", serviceKey]]) {
  if (!value) throw new Error("Missing required worker setting: " + name);
}
if (processorUrl && !processorKey) throw new Error("CLIP_PROCESSOR_API_KEY is required when CLIP_PROCESSOR_URL is set.");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const pollMs = Math.max(1500, Number(process.env.WORKER_POLL_MS || 5000));
const workerName = process.env.WORKER_NAME || "aura-local-worker";
const maxClips = 5;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const localProcessorScript = fileURLToPath(new URL("./local_clip_processor.py", import.meta.url));
const projectRoot = resolve(dirname(localProcessorScript), "..");

console.log("Aura OS worker started in", processorUrl ? "remote-processor mode" : "local CPU processing mode");
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
  let workDir;
  let clipsPersisted = false;
  const outputPaths = [];
  try {
    let sourceUrl = job.source_url;
    if (job.storage_path) {
      const { data, error } = await supabase.storage.from("source-videos").createSignedUrl(job.storage_path, 6 * 60 * 60);
      if (error || !data?.signedUrl) throw new Error("Could not sign the source video URL.");
      sourceUrl = data.signedUrl;
    }
    if (!sourceUrl) throw new Error("The video has no readable source. Upload a video file you own or have permission to edit.");

    const uploadSlots = [];
    for (let i = 1; i <= maxClips; i++) {
      const path = `${job.owner_id}/${job.job_id}/clip-${String(i).padStart(3, "0")}.mp4`;
      const { data, error } = await supabase.storage.from("clip-exports").createSignedUploadUrl(path);
      if (error || !data?.token) throw new Error("Could not prepare private clip output storage.");
      uploadSlots.push({ index: i, path, token: data.token });
      outputPaths.push(path);
    }

    let payload;
    if (processorUrl) {
      payload = await callRemoteProcessor(job, sourceUrl, uploadSlots);
    } else {
      const localResult = await callLocalProcessor(sourceUrl, url);
      payload = localResult.payload;
      workDir = localResult.workDir;
    }
    if (!Array.isArray(payload?.clips) || payload.clips.length < 1 || payload.clips.length > maxClips) {
      throw new Error("The processor did not return between 1 and 5 clips.");
    }

    const rows = [];
    const usedSlots = new Set();
    for (const [index, clip] of payload.clips.entries()) {
      const outputIndex = Number(clip.output_index);
      const slot = uploadSlots[outputIndex - 1];
      const start = Number(clip.start_seconds);
      const end = Number(clip.end_seconds);
      const score = clip.virality_score == null ? null : Number(clip.virality_score);
      if (!slot || usedSlots.has(outputIndex) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw new Error("The processor returned invalid clip metadata.");
      }
      if (score != null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new Error("The processor returned an invalid score.");

      if (!processorUrl) {
        const outputFile = String(clip.output_file || "");
        if (!outputFile) throw new Error("The local processor did not create a clip file.");
        const bytes = await readFile(outputFile);
        if (bytes.length < 1024) throw new Error("A generated clip file is empty or incomplete.");
        const { error: uploadError } = await supabase.storage.from("clip-exports").uploadToSignedUrl(
          slot.path, slot.token, bytes, { contentType: "video/mp4", cacheControl: "3600" },
        );
        if (uploadError) throw new Error("Could not upload a generated clip: " + uploadError.message);
      }

      usedSlots.add(outputIndex);
      rows.push({
        owner_id: job.owner_id, video_id: job.video_id, job_id: job.job_id,
        title: String(clip.title || `Clip ${index + 1}`).slice(0, 180),
        start_seconds: start, end_seconds: end, virality_score: score,
        transcript: clip.transcript ? String(clip.transcript).slice(0, 12000) : null,
        output_path: slot.path,
      });
    }

    for (const row of rows) {
      const slash = row.output_path.lastIndexOf("/");
      const folder = row.output_path.slice(0, slash);
      const filename = row.output_path.slice(slash + 1);
      const { data: objects, error } = await supabase.storage.from("clip-exports").list(folder, { search: filename, limit: 10 });
      if (error || !objects?.some(object => object.name === filename)) throw new Error("The processor did not upload every generated clip.");
    }

    const { error: insertError } = await supabase.from("clips").insert(rows);
    if (insertError) throw insertError;
    clipsPersisted = true;
    const { error: jobError } = await supabase.from("clip_jobs").update({ status: "completed", progress: 100, error: null, updated_at: new Date().toISOString() }).eq("id", job.job_id);
    if (jobError) throw jobError;
    const { error: videoError } = await supabase.from("videos").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", job.video_id);
    if (videoError) throw videoError;
    console.log("Completed job", job.job_id, "with", rows.length, "clips");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error.";
    const safeMessage = message.slice(0, 1000);
    if (!clipsPersisted && outputPaths.length > 0) {
      const { error: cleanupError } = await supabase.storage.from("clip-exports").remove(outputPaths);
      if (cleanupError) console.error("Could not clean up incomplete clip files:", cleanupError.message);
    }
    await supabase.from("clip_jobs").update({ status: "failed", error: safeMessage, updated_at: new Date().toISOString() }).eq("id", job.job_id);
    await supabase.from("videos").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", job.video_id);
    console.error("Job failed", job.job_id, safeMessage);
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function callRemoteProcessor(job, sourceUrl, outputUploads) {
  const response = await fetch(processorUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + processorKey },
    body: JSON.stringify({
      jobId: job.job_id, videoId: job.video_id, sourceUrl,
      outputBucket: "clip-exports", outputPathPrefix: `${job.owner_id}/${job.job_id}/`, outputUploads,
    }),
    signal: AbortSignal.timeout(45 * 60 * 1000),
  });
  if (!response.ok) throw new Error("Clip processor returned HTTP " + response.status + ".");
  return response.json();
}

async function callLocalProcessor(sourceUrl, supabaseOrigin) {
  const workDir = await mkdtemp(join(tmpdir(), "aura-os-"));
  const configuredPython = process.env.PYTHON_EXECUTABLE || (process.platform === "win32" ? "py" : "python3");
  const pythonCommand = isAbsolute(configuredPython) || /[\\/]/.test(configuredPython)
    ? (isAbsolute(configuredPython) ? configuredPython : resolve(projectRoot, configuredPython))
    : configuredPython;
  const args = [...(process.platform === "win32" && basename(pythonCommand).toLowerCase() === "py" ? ["-3"] : []), localProcessorScript];
  const child = spawn(pythonCommand, args, {
    cwd: workDir,
    stdio: ["pipe", "pipe", "pipe"],
    // The processor receives a signed source URL, but never the worker's service-role key.
    env: {
      PATH: process.env.PATH || "",
      ...(process.env.USERPROFILE ? { USERPROFILE: process.env.USERPROFILE } : {}),
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...(process.env.HF_HOME ? { HF_HOME: process.env.HF_HOME } : {}),
      PYTHONUNBUFFERED: "1",
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-1_000_000); });
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-50_000); });
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Local processing exceeded 50 minutes.")); }, 50 * 60 * 1000);
    child.once("error", error => { clearTimeout(timeout); reject(new Error("Could not start Python. Install Python 3.11 and the worker requirements. " + error.message)); });
    child.once("close", code => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(stderr.trim().slice(-1400) || `Local processor exited with code ${code}.`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error("Local processor returned invalid output.")); }
    });
  });
  child.stdin.end(JSON.stringify({ sourceUrl, supabaseOrigin, workDir, model: process.env.WHISPER_MODEL || "base" }));
  return result.then(payload => ({ payload, workDir }), async error => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  });
}
