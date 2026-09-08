"use client";

import { getCachedAudioUrl, getLocalTrackAudioUrl } from "@/lib/db/indexeddb";
import { isExtensionAvailable, resolveViaExtension } from "@/lib/extension-bridge";
import type { Track } from "@/lib/types";

export interface ResolvedAudio {
  url: string;
  /**
   * True for a URL the browser can load as-is with no server involved: an
   * IndexedDB cache hit (blob:) or a raw googlevideo.com URL from the
   * extension. hooks/use-player.ts skips /api/extract's ?probe=1 step for
   * these (there's nothing at that URL to probe) and its background
   * IndexedDB-caching fetch (a googlevideo.com URL can't be read via fetch()
   * cross-origin — see extension/background.js's doc comment — though the
   * <audio> element itself can still play and seek it directly, same as any
   * cross-origin <video src>).
   */
  isDirect: boolean;
}

/**
 * Resolves a Track to something an <audio> element can actually play.
 * - local tracks: read straight out of IndexedDB.
 * - youtube tracks: check the IndexedDB audio cache first; on a miss, try
 *   the music.player Companion browser extension (lib/extension-bridge.ts —
 *   resolves from the user's own browser/IP, no server involved); fall back
 *   to /api/extract (server-side, via Invidious Companion) if the extension
 *   isn't installed or fails. There's no separate "matching" step — search
 *   results already *are* the video that gets played.
 *
 * The /api/extract fallback points straight at the route instead of
 * awaiting the whole thing as a Blob first: the route proxies bytes
 * straight through from Invidious Companion's videoplayback stream (see
 * lib/companion.ts) as they arrive, and <audio src="..."> buffers/plays
 * that progressively on its own, so playback starts immediately instead of
 * after the entire song has been fetched. A fresh play still ends up in the
 * IndexedDB cache — hooks/use-player.ts kicks off a second, background
 * fetch of the same URL right after playback starts, so a replay skips the
 * network (and Companion) entirely.
 */
export async function resolveTrackAudio(track: Track): Promise<ResolvedAudio> {
  if (track.source === "local") {
    const url = await getLocalTrackAudioUrl(track.id);
    if (!url) throw new Error("로컬 파일을 찾을 수 없습니다");
    return { url, isDirect: true };
  }

  const cachedUrl = await getCachedAudioUrl(track.videoId);
  if (cachedUrl) return { url: cachedUrl, isDirect: true };

  if (await isExtensionAvailable()) {
    const extracted = await resolveViaExtension(track.videoId);
    if (extracted) return { url: extracted.url, isDirect: true };
    // Extension installed but this particular video failed (private,
    // region-locked, needs signature deciphering, ...) — fall through to
    // the server path rather than failing outright.
  }

  return { url: `/api/extract?videoId=${track.videoId}`, isDirect: false };
}
