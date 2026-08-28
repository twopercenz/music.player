import "server-only";
import type { ItunesSearchResult } from "./types";

export interface ItunesEnrichment {
  title: string;
  artist: string;
  album?: string;
  artworkUrl: string;
}

interface ItunesTrackResult {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
}

interface ItunesSearchResponse {
  results: ItunesTrackResult[];
}

/** Swaps iTunes' default 100x100 thumbnail for a much larger one — same URL, bigger size. */
function upscaleArtwork(url: string, size = 1200): string {
  return url.replace(/\d+x\d+bb\.(jpg|png)/, `${size}x${size}bb.$1`);
}

/**
 * The search autocomplete itself — real catalog metadata + real square art,
 * instead of guessing from YouTube video titles. Picking a result still needs
 * a separate step (lib/youtube.ts matchYoutubeTrack) to find something to
 * actually play, since playback is still YouTube-sourced.
 */
export async function searchItunesTracks(
  query: string,
  { limit = 10 }: { limit?: number } = {},
): Promise<ItunesSearchResult[]> {
  if (!query.trim()) return [];

  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("country", "KR");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`);

  const { results } = (await res.json()) as ItunesSearchResponse;
  return results
    .filter((r) => r.trackTimeMillis)
    .map((r) => ({
      itunesId: r.trackId,
      title: r.trackName,
      artist: r.artistName,
      album: r.collectionName,
      durationMs: r.trackTimeMillis!,
      artworkUrl: r.artworkUrl100 ? upscaleArtwork(r.artworkUrl100) : undefined,
    }));
}

/**
 * Looks up clean metadata + real square album art on the free, unauthenticated
 * iTunes Search API (not the paid Apple Music/MusicKit API — no developer
 * account needed). Used only to *enrich* the display of whatever track is
 * currently playing; playback itself still comes from YouTube regardless of
 * whether this finds a match, so getting it wrong just means falling back to
 * the YouTube thumbnail rather than breaking anything.
 */
export async function findItunesMatch(
  artist: string,
  title: string,
  durationMs: number,
): Promise<ItunesEnrichment | null> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", `${artist} ${title}`);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("country", "KR");
  url.searchParams.set("limit", "5");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const { results } = (await res.json()) as ItunesSearchResponse;
  if (results.length === 0) return null;

  const closest = results.reduce((best, candidate) => {
    const bestDelta = Math.abs((best.trackTimeMillis ?? Infinity) - durationMs);
    const candidateDelta = Math.abs((candidate.trackTimeMillis ?? Infinity) - durationMs);
    return candidateDelta < bestDelta ? candidate : best;
  });

  const delta = Math.abs((closest.trackTimeMillis ?? Infinity) - durationMs);
  if (delta > 15_000 || !closest.artworkUrl100) return null; // not confident enough to use

  return {
    title: closest.trackName,
    artist: closest.artistName,
    album: closest.collectionName,
    artworkUrl: upscaleArtwork(closest.artworkUrl100),
  };
}
