import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to upload a video." }, { status: 401 });

  let body: { fileName?: string; contentType?: string; size?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const fileName = (body.fileName ?? "").replace(/[^\w.-]/g, "_").slice(-100);
  const contentType = body.contentType ?? "";
  const size = Number(body.size);
  if (!fileName || !ALLOWED_VIDEO_TYPES.has(contentType) || !Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return NextResponse.json({ error: "Choose a video file under 2 GB." }, { status: 400 });
  }

  const videoId = crypto.randomUUID();
  const storagePath = user.id + "/" + videoId + "/" + fileName;
  const { data: video, error: dbError } = await supabase.from("videos").insert({
    id: videoId, owner_id: user.id, title: fileName.replace(/\.[^.]+$/, ""),
    source_type: "upload", storage_path: storagePath, file_size_bytes: size,
    content_type: contentType, status: "uploading",
  }).select("id").single();
  if (dbError || !video) return NextResponse.json({ error: dbError?.message ?? "Could not create the video record." }, { status: 500 });

  const { data: signed, error: signedError } = await supabase.storage.from("source-videos").createSignedUploadUrl(storagePath);
  if (signedError || !signed?.token) {
    await supabase.from("videos").delete().eq("id", videoId);
    return NextResponse.json({ error: signedError?.message ?? "Could not prepare the secure upload." }, { status: 500 });
  }
  return NextResponse.json({ videoId, path: storagePath, token: signed.token }, { status: 201 });
}
