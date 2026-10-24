import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import JobRefresh from "@/components/job-refresh";
import DeleteVideoButton from "@/components/delete-video-button";
import VideoIntake from "@/components/video-intake";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type VideoRow = { id: string; title: string; source_type: string; status: string; created_at: string };
type JobRow = { id: string; video_id: string; status: string; progress: number; error: string | null; created_at: string };
type ClipRow = { id: string; title: string; start_seconds: number; end_seconds: number; virality_score: number | null; transcript: string | null; output_path: string };
type ProfileRow = { videos_used: number; month_start: string };

function formatCreatedAt(value: string) {
  return new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = error ? null : data?.claims ?? null;
  const userId = claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: videos }, { data: jobs }, { data: clips }, { data: profile }] = await Promise.all([
    supabase.from("videos").select("id,title,source_type,status,created_at").order("created_at", { ascending: false }),
    supabase.from("clip_jobs").select("id,video_id,status,progress,error,created_at").order("created_at", { ascending: false }),
    supabase.from("clips").select("id,title,start_seconds,end_seconds,virality_score,transcript,output_path").order("created_at", { ascending: false }).limit(20),
    supabase.from("profiles").select("videos_used,month_start").eq("owner_id", userId).maybeSingle(),
  ]);
  const videoRows = (videos ?? []) as VideoRow[];
  const jobRows = (jobs ?? []) as JobRow[];
  const jobsByVideo = new Map<string, JobRow>();
  for (const job of jobRows) if (!jobsByVideo.has(job.video_id)) jobsByVideo.set(job.video_id, job);
  const clipRows = (clips ?? []) as ClipRow[];
  const usage = profile as ProfileRow | null;
  const currentMonthStart = new Date().toISOString().slice(0, 7) + "-01";
  const videosUsedThisMonth = usage?.month_start === currentMonthStart ? usage.videos_used : 0;
  const clipsWithUrls = await Promise.all(clipRows.map(async clip => {
    const { data } = await supabase.storage.from("clip-exports").createSignedUrl(clip.output_path, 3600);
    return { ...clip, signedUrl: data?.signedUrl ?? null };
  }));
  const emailClaim = claims?.email;
  const email = typeof emailClaim === "string" ? emailClaim : "Creator";

  return <main className="dashboard">
    <header className="dashbar"><Link className="brand" href="/"><span className="brandmark">✦</span>Aura OS</Link><form action={signOut}><button className="logout" type="submit">Sign out · {email}</button></form></header>
    <div className="dashcontent">
      <JobRefresh active={jobRows.some(job => job.status === "queued" || job.status === "processing")} />
      <div className="eyebrow">Free creator workspace · {videosUsedThisMonth}/1 video this month</div><h1>Your videos, moving forward.</h1><p>Upload a short video you own or have permission to edit. Aura transcribes it, ranks moments, and prepares captioned vertical clips.</p>
      <VideoIntake supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} publishableKey={process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""} />
      <div className="setup-note"><strong>Free beta processing</strong><p>Run <code>npm run worker</code> on the computer where you installed Aura’s local processing tools. That computer must stay on while a video is being processed. Your clips remain in your private Supabase storage.</p></div>
      <div className="section-head" style={{ textAlign: "left", margin: "30px 0 14px" }}><h2 style={{ fontSize: 18, margin: 0 }}>Recent videos &amp; jobs</h2></div>
      <div className="job-list">
        {videoRows.length === 0 && <div className="empty">No videos yet. Upload a source video you own or have permission to edit to get started.</div>}
        {videoRows.map(video => {
          const job = jobsByVideo.get(video.id);
          return <article className="job" key={video.id}>
            <div><h3>{video.title || "Untitled video"}</h3><p>{video.source_type === "youtube" ? "YouTube link (not processed)" : "Uploaded video"} · {formatCreatedAt(video.created_at)}</p>{job?.error && <p className="error">{job.error}</p>}</div>
            <div className="job-tools"><span className="job-status">{job ? job.status + (job.status === "processing" ? " · " + job.progress + "%" : "") : video.status}</span><DeleteVideoButton videoId={video.id} title={video.title || "this video"} /></div>
          </article>;
        })}
      </div>
      {clipsWithUrls.length > 0 && <><div className="section-head" style={{ textAlign: "left", margin: "30px 0 14px" }}><h2 style={{ fontSize: 18, margin: 0 }}>Ready to review</h2></div><div className="clip-grid">{clipsWithUrls.map(clip => <article className="clip-result" key={clip.id}>{clip.signedUrl ? <video src={clip.signedUrl} controls preload="metadata" /> : <div className="clip-unavailable">Preview unavailable</div>}<div className="clip-result-body"><h3>{clip.title}</h3><p>{clip.start_seconds.toFixed(1)}s – {clip.end_seconds.toFixed(1)}s{clip.virality_score !== null ? " · Aura score " + clip.virality_score : ""}</p>{clip.transcript && <blockquote>{clip.transcript}</blockquote>}<a href={clip.signedUrl ?? "#"} download>Download clip ↗</a></div></article>)}</div></>}
      {jobRows.some(job => job.status === "queued") && <p className="micro">Your video is saved. “Queued” means your local worker has not claimed it yet. Start it with <code>npm run worker</code>.</p>}
      {jobRows.some(job => job.status === "processing") && <p className="micro">Job status refreshes while processing is active.</p>}
    </div>
  </main>;
}
