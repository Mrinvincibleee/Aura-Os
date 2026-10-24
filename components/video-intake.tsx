"use client";
import { useRef, useState } from "react";
import * as tus from "tus-js-client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
type Props = { supabaseUrl: string; publishableKey: string };
export default function VideoIntake({ supabaseUrl, publishableKey }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function uploadFile(file: File) {
    setBusy(true); setError(""); setMessage("Preparing secure upload…"); setProgress(0);
    try {
      if (!["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"].includes(file.type)) throw new Error("Choose an MP4, MOV, or WebM video file.");
      if (file.size > 45 * 1024 * 1024) throw new Error("Free beta uploads must be 45 MB or smaller.");
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
      setProgress(100); setMessage("Upload complete. Your clip job is queued for your Aura worker."); router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed."); setMessage("");
    } finally { setBusy(false); }
  }

  return <section className="intake-card">
    <div className="intake">
      <div><strong>Upload a source video you own or have permission to edit.</strong><p className="micro">MP4, MOV, or WebM · 45 MB max on Supabase Free · up to 30 minutes · 1 upload/month</p></div>
      <button className="btn primary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? "Working…" : "Upload a video ↗"}</button>
      <div className="intake-bottom"><span>We don’t download videos from YouTube links. Export your own source and upload it here.</span><input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void uploadFile(file); e.currentTarget.value = ""; }} /></div>
    </div>
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
