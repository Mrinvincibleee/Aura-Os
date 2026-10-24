import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, context: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to delete this video." }, { status: 401 });

  const { data: video, error: videoError } = await supabase
    .from("videos").select("id,storage_path").eq("id", videoId).maybeSingle();
  if (videoError || !video) return NextResponse.json({ error: "Video not found." }, { status: 404 });

  const { data: activeJob, error: activeJobError } = await supabase
    .from("clip_jobs").select("status").eq("video_id", videoId).in("status", ["queued", "processing"]).maybeSingle();
  if (activeJobError) return NextResponse.json({ error: "Could not confirm the job is idle. Try again." }, { status: 500 });
  if (activeJob) return NextResponse.json({ error: "Wait for this job to finish before deleting its files." }, { status: 409 });

  const { data: clips, error: clipsError } = await supabase
    .from("clips").select("output_path").eq("video_id", videoId);
  if (clipsError) return NextResponse.json({ error: "Could not load this video's clip files." }, { status: 500 });

  const clipPaths = (clips ?? []).map(clip => clip.output_path).filter(Boolean);
  if (clipPaths.length > 0) {
    const { error } = await supabase.storage.from("clip-exports").remove(clipPaths);
    if (error) return NextResponse.json({ error: "Could not remove all private clip files. The video record was kept." }, { status: 500 });
  }
  if (video.storage_path) {
    const { error } = await supabase.storage.from("source-videos").remove([video.storage_path]);
    if (error) return NextResponse.json({ error: "Could not remove the private source file. The video record was kept." }, { status: 500 });
  }

  const { error: deleteError } = await supabase.from("videos").delete().eq("id", videoId);
  if (deleteError) return NextResponse.json({ error: "Files were removed, but the video record could not be deleted." }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
