import { NextRequest, NextResponse } from "next/server";
import { CompanionError, resolvePlayableAudio } from "@/lib/companion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId");
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: "invalid videoId" }, { status: 400 });
  }

  // <audio src="..."> can't read a failed request's JSON error body — it
  // just shows a generic browser error. hooks/use-player.ts calls this once
  // with ?probe=1 before ever setting audio.src, so a real Companion failure
  // (private video, region lock, PO token still warming up, etc.) can be
  // shown for what it actually is. This re-resolves rather than reusing a
  // stashed result — Companion caches its own player-info lookup for an
  // hour (see its youtubePlayerHandling.ts), so a probe immediately followed
  // by the real request is cheap, not a second full extraction like the old
  // yt-dlp+ffmpeg pipeline would have been.
  const isProbe = request.nextUrl.searchParams.get("probe") === "1";

  try {
    const audio = await resolvePlayableAudio(videoId, request.signal);
    if (isProbe) return NextResponse.json({ ok: true });
    return proxyAudio(audio.url, audio.mimeType, request);
  } catch (error) {
    console.error(`extract${isProbe ? " probe" : ""} failed for ${videoId}`, error);
    const message =
      error instanceof CompanionError || error instanceof Error
        ? error.message
        : "오디오 추출에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Streams bytes straight through from Companion's own videoplayback proxy —
 * which already supports Range requests against the real upstream file — so
 * <audio> can seek from the very first play, not just on a cache hit the way
 * the old live-extraction stream (no Content-Length, no Range) required.
 */
async function proxyAudio(url: string, mimeType: string, request: NextRequest): Promise<Response> {
  const range = request.headers.get("range");
  const upstream = await fetch(url, {
    headers: range ? { range } : undefined,
    signal: request.signal,
    cache: "no-store",
  });

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") || mimeType,
    "Cache-Control": "no-store",
  });
  for (const name of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
