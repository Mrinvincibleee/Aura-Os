"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteVideoButton({ videoId, title }: { videoId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function removeVideo() {
    if (!window.confirm(`Permanently delete “${title}”, its source file, clips, and job history?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/videos/${videoId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete this video.");
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not delete this video.");
    } finally {
      setBusy(false);
    }
  }

  return <button className="btn danger" type="button" disabled={busy} onClick={() => void removeVideo()}>{busy ? "Deleting…" : "Delete files"}</button>;
}
