"use client";

import { getCachedAudioUrl, getLocalTrackAudioUrl } from "@/lib/db/indexeddb";
import type { Track } from "@/lib/types";

export interface ResolvedAudio {
  url: string;
}

/**
 * Resolves a Track to something an <audio> element can actually play.
 * - local tracks: read straight out of IndexedDB.
 * - youtube tracks: check the IndexedDB audio cache first, and only hit
 *   /api/extract (the expensive, yt-dlp-backed step) on a cache miss. There's
 *   no separate "matching" step anymore — search results already *are* the
 *   video that gets played.
 *
 * A cache miss points straight at /api/extract instead of awaiting the whole
 * transcode as a Blob first: the route streams bytes out as ffmpeg produces
 * them (see lib/extract.ts), and <audio src="..."> buffers/plays that
 * progressively on its own, so playback starts as soon as the first couple
 * seconds of audio exist instead of after the entire (multi-minute) song has
 * finished extracting. A fresh play still ends up in the IndexedDB cache —
 * hooks/use-player.ts kicks off a second, background fetch of the same URL
 * right after playback starts, and by then the server's own tmp cache (see
 * lib/audio-cache.ts) usually means that fetch reads a file instead of
 * running yt-dlp+ffmpeg a second time.
 */
export async function resolveTrackAudio(track: Track): Promise<ResolvedAudio> {
  if (track.source === "local") {
    const url = await getLocalTrackAudioUrl(track.id);
    if (!url) throw new Error("로컬 파일을 찾을 수 없습니다");
    return { url };
  }

  const cachedUrl = await getCachedAudioUrl(track.videoId);
  if (cachedUrl) return { url: cachedUrl };

  return { url: `/api/extract?videoId=${track.videoId}` };
}
