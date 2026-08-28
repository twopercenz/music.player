import { NextRequest, NextResponse } from "next/server";
import { extractAudioStream } from "@/lib/extract";

// Needs child_process (yt-dlp/ffmpeg) — must run in the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId");
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: "invalid videoId" }, { status: 400 });
  }

  try {
    const stream = await extractAudioStream(videoId);
    return new Response(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`extract failed for ${videoId}`, error);
    const message = error instanceof Error ? error.message : "오디오 추출에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
