import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(_request: Request, context: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to queue this upload." }, { status: 401 });

  const { data: video, error: videoError } = await supabase.from("videos").select("id,storage_path,source_type").eq("id", videoId).maybeSingle();
  if (videoError || !video) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  if (video.source_type !== "upload" || !video.storage_path) return NextResponse.json({ error: "This endpoint only queues uploaded files." }, { status: 400 });

  const lastSlash = video.storage_path.lastIndexOf("/");
  const folder = video.storage_path.slice(0, lastSlash);
  const name = video.storage_path.slice(lastSlash + 1);
  const { data: objects, error: storageError } = await supabase.storage.from("source-videos").list(folder, { search: name, limit: 20 });
  if (storageError || !objects?.some(object => object.name === name)) {
    return NextResponse.json({ error: "The upload is not present in private storage yet." }, { status: 409 });
  }

  const { data: jobId, error: queueError } = await supabase.rpc("queue_video_job", { p_video_id: videoId });
  if (queueError) return NextResponse.json({ error: queueError.message }, { status: 409 });
  return NextResponse.json({ videoId, jobId }, { status: 201 });
}
