import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedHosts = new Set(["youtube.com", "m.youtube.com", "youtu.be"]);
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to add a video." }, { status: 401 });

  let body: { url?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  let parsed: URL;
  try { parsed = new URL(body.url ?? ""); } catch { return NextResponse.json({ error: "Enter a valid YouTube URL." }, { status: 400 }); }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const hasVideoId = parsed.searchParams.has("v") || (host === "youtu.be" && parsed.pathname.length > 1) || /^\/(shorts|live)\/[^/]+/.test(parsed.pathname);
  if (parsed.protocol !== "https:" || !allowedHosts.has(host) || !hasVideoId) {
    return NextResponse.json({ error: "Use a YouTube video, Shorts, or live replay link." }, { status: 400 });
  }

  const title = "YouTube video · " + (parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).at(-1) || "source");
  const { data: video, error: insertError } = await supabase.from("videos").insert({
    owner_id: user.id, title, source_type: "youtube", source_url: parsed.toString(), status: "received",
  }).select("id").single();
  if (insertError || !video) return NextResponse.json({ error: insertError?.message ?? "Could not save the video." }, { status: 500 });

  const { data: jobId, error: queueError } = await supabase.rpc("queue_video_job", { p_video_id: video.id });
  if (queueError) {
    await supabase.from("videos").delete().eq("id", video.id);
    return NextResponse.json({ error: queueError.message }, { status: 409 });
  }
  return NextResponse.json({ videoId: video.id, jobId }, { status: 201 });
}
