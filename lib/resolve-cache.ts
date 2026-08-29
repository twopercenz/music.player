import "server-only";
import { getSupabaseServerClient } from "./supabase";

/**
 * Caches /api/resolve's YouTube Data API match (search.list + videos.list =
 * 101 quota units per call, against a 10k/day free quota — see lib/youtube.ts)
 * so the same (artist, title, duration) combo only ever resolves once.
 */
export function buildResolveCacheKey(artist: string, title: string, durationMs: number): string {
  const durationSeconds = Math.round(durationMs / 1000);
  return `${artist.toLowerCase()}|${title.toLowerCase()}|${durationSeconds}`;
}

// This cache is a nice-to-have on top of the real matching logic, not a
// hard dependency — unlike /api/library, /api/resolve worked without
// Supabase before this cache existed. So a missing/misconfigured Supabase
// client (getSupabaseServerClient() throws) degrades to "always miss"
// rather than breaking playback resolution entirely.

export async function getCachedResolve(cacheKey: string): Promise<string | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("resolve_cache")
      .select("video_id")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error) {
      console.error("resolve cache lookup failed", error);
      return null;
    }
    return data?.video_id ?? null;
  } catch (err) {
    console.error("resolve cache lookup failed", err);
    return null;
  }
}

export async function setCachedResolve(cacheKey: string, videoId: string): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("resolve_cache")
      .upsert({ cache_key: cacheKey, video_id: videoId, resolved_at: new Date().toISOString() });

    if (error) console.error("resolve cache write failed", error);
  } catch (err) {
    console.error("resolve cache write failed", err);
  }
}
