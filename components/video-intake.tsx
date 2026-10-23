"use client";
import { FormEvent, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
type Props = { supabaseUrl: string; publishableKey: string };
export default function VideoIntake({ supabaseUrl, publishableKey }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function addYoutube(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("Adding video to your queue…");
    try {
      const response = await fetch("/api/videos/youtube", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not add this video.");
      setUrl(""); setMessage("Video added to your persistent job queue."); router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add this video."); setMessage("");
    } finally { setBusy(false); }
  }

  async function uploadFile(file: File) {
    setBusy(true); setError(""); setMessage("Preparing secure upload…"); setProgress(0);
    try {
      if (!file.type.startsWith("video/")) throw new Error("Choose a video file.");
      if (file.size > 2 * 1024 * 1024 * 1024) throw new Error("Maximum file size is 2 GB.");
      const response = await fetch("/api/videos/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start upload.");
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in and try again.");

      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: resumableEndpoint(supabaseUrl),
          headers: { apikey: publishableKey, authorization: "Bearer " + session.access_token, "x-signature": data.token },
          metadata: { bucketName: "source-videos", objectName: data.path, contentType: file.type || "video/mp4", cacheControl: "3600" },
          chunkSize: 6 * 1024 * 1024, retryDelays: [0, 3000, 5000, 10000, 20000], removeFingerprintOnSuccess: true,
          onProgress(bytesUploaded, bytesTotal) { setProgress(Math.round(bytesUploaded / bytesTotal * 100)); setMessage("Uploading video…"); },
          onError(uploadError) { reject(uploadError); },
          onSuccess() {
            void (async () => {
              const queued = await fetch("/api/videos/" + data.videoId + "/queue", { method: "POST" });
              const result = await queued.json();
              if (!queued.ok) throw new Error(result.error ?? "Upload finished, but the job could not be queued.");
              resolve();
            })().catch(reject);
          },
        });
        upload.start();
      });
      setProgress(100); setMessage("Upload complete. Your clip job is queued."); router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed."); setMessage("");
    } finally { setBusy(false); }
  }

  return <section className="intake-card">
    <form className="intake" onSubmit={addYoutube}>
      <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a YouTube video link" aria-label="YouTube video URL" required />
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Working…" : "Find clips ↗"}</button>
      <div className="intake-bottom"><button className="btn secondary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Upload a video</button><span>MP4, MOV, WebM · up to 2 GB</span><input ref={fileInput} type="file" accept="video/*" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void uploadFile(file); e.currentTarget.value = ""; }} /></div>
    </form>
    {busy && progress > 0 && <div className="upload-progress" aria-label={"Upload " + progress + "%"}><i style={{ width: progress + "%" }} /></div>}
    {message && <p className="statusline" role="status">{message}{progress > 0 ? " " + progress + "%" : ""}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
function resumableEndpoint(supabaseUrl: string) {
  const parsed = new URL(supabaseUrl);
  if (parsed.hostname.endsWith(".supabase.co")) {
    const projectRef = parsed.hostname.slice(0, -".supabase.co".length);
    return "https://" + projectRef + ".storage.supabase.co/storage/v1/upload/resumable";
  }
  return parsed.origin + "/storage/v1/upload/resumable";
}
