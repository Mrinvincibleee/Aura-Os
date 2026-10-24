import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    error: "Aura does not download videos from YouTube. Export a video you own or have permission to edit, then upload the file.",
  }, { status: 410 });
}
