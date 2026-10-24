import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
// Supabase Free projects cap individual objects at 50 MB. Leave a little headroom.
const MAX_BYTES = 45 * 1024 * 1024;
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
    return NextResponse.json({ error: "Choose an MP4, MOV, or WebM video under 45 MB." }, { status: 400 });
  }

  const videoId = crypto.randomUUID();
  const storagePath = user.id + "/" + videoId + "/" + fileName;
  const { data: signed, error: signedError } = await supabase.storage.from("source-videos").createSignedUploadUrl(storagePath);
  if (signedError || !signed?.token) return NextResponse.json({ error: "Could not prepare the secure upload. Check the source-videos bucket and Supabase Free upload limit." }, { status: 500 });

  const { data: reservedId, error: reserveError } = await supabase.rpc("reserve_video_upload", {
    p_video_id: videoId,
    p_title: fileName.replace(/\.[^.]+$/, ""),
    p_storage_path: storagePath,
    p_file_size: Math.trunc(size),
    p_content_type: contentType,
  });
  if (reserveError) {
    if (reserveError.message.includes("free_monthly_video_limit_reached")) {
      return NextResponse.json({ error: "Free plan limit reached: you can upload one source video per month." }, { status: 429 });
    }
    const migrationMissing = reserveError.message.includes("reserve_video_upload") || reserveError.message.includes("profiles");
    return NextResponse.json({ error: migrationMissing ? "Apply the Aura OS free-beta database migration in Supabase, then try again." : "Could not reserve this upload. Verify the file settings and retry." }, { status: migrationMissing ? 503 : 400 });
  }
  if (reservedId !== videoId) return NextResponse.json({ error: "Could not reserve this upload." }, { status: 500 });
  return NextResponse.json({ videoId, path: storagePath, token: signed.token }, { status: 201 });
}
