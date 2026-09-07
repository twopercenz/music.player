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
 *   /api/extract on a cache miss. There's no separate "matching" step
 *   anymore — search results already *are* the video that gets played.
 *
 * A cache miss points straight at /api/extract instead of awaiting the whole
 * thing as a Blob first: the route proxies bytes straight through from
 * Invidious Companion's videoplayback stream (see lib/companion.ts) as they
 * arrive, and <audio src="..."> buffers/plays that progressively on its own,
 * so playback starts immediately instead of after the entire song has been
 * fetched. A fresh play still ends up in the IndexedDB cache —
 * hooks/use-player.ts kicks off a second, background fetch of the same URL
 * right after playback starts, so a replay skips the network (and Companion)
 * entirely.
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
