import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import {
  claimPendingStream,
  extractAudioStream,
  extractAudioStreamForProbe,
  TooManyExtractionsError,
} from "@/lib/extract";
import { getCachedPath } from "@/lib/audio-cache";

// Needs child_process (yt-dlp/ffmpeg) — must run in the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId");
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: "invalid videoId" }, { status: 400 });
  }

  // <audio src="..."> can't read a failed request's JSON error body — it
  // just shows a generic browser error. hooks/use-player.ts calls this once
  // with ?probe=1 before ever setting audio.src, so a real yt-dlp/ffmpeg
  // failure (private video, etc.) can be shown for what it actually is.
  const isProbe = request.nextUrl.searchParams.get("probe") === "1";

  // A previous extraction already wrote this videoId to the server-side tmp
  // cache (see lib/audio-cache.ts) — serve the file directly instead of
  // running yt-dlp+ffmpeg again. Being a plain file also lets us support
  // Range requests, which the live streaming path below can't.
  const cachedPath = getCachedPath(videoId);
  if (cachedPath) {
    if (isProbe) return NextResponse.json({ ok: true });
    return serveCachedFile(cachedPath, request.headers.get("range"));
  }

  if (!isProbe) {
    // A probe for this exact videoId already ran the real extraction and
    // left it running for us — see lib/extract.ts — instead of starting a
    // second yt-dlp+ffmpeg pair for the same video.
    const reused = claimPendingStream(videoId);
    if (reused) {
      if (request.signal.aborted) reused.abort();
      else request.signal.addEventListener("abort", reused.abort, { once: true });
      return new Response(reused.stream, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
      });
    }
  }

  try {
    if (isProbe) {
      await extractAudioStreamForProbe(videoId, request.signal);
      return NextResponse.json({ ok: true });
    }
    const stream = await extractAudioStream(videoId, request.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof TooManyExtractionsError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": "10" } },
      );
    }
    console.error(`extract${isProbe ? " probe" : ""} failed for ${videoId}`, error);
    const message = error instanceof Error ? error.message : "오디오 추출에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function serveCachedFile(path: string, rangeHeader: string | null): Response {
  const { size } = statSync(path);

  const range = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end && end < size) {
      const stream = Readable.toWeb(
        createReadStream(path, { start, end }),
      ) as ReadableStream<Uint8Array>;
      return new Response(stream, {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
