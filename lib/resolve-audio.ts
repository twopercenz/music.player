"use client";

import { getCachedAudioUrl, cacheAudio, getLocalTrackAudioUrl } from "@/lib/db/indexeddb";
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
 */
export async function resolveTrackAudio(track: Track): Promise<ResolvedAudio> {
  if (track.source === "local") {
    const url = await getLocalTrackAudioUrl(track.id);
    if (!url) throw new Error("로컬 파일을 찾을 수 없습니다");
    return { url };
  }

  const cachedUrl = await getCachedAudioUrl(track.videoId);
  if (cachedUrl) return { url: cachedUrl };

  const res = await fetch(`/api/extract?videoId=${track.videoId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "오디오 추출에 실패했습니다.");
  }
  const blob = await res.blob();
  const url = await cacheAudio(track.videoId, blob);

  return { url };
}
