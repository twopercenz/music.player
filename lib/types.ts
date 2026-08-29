/** A track found via YouTube search — search and playback are the same source now. */
export interface YoutubeTrack {
  source: "youtube";
  videoId: string;
  title: string;
  artist: string;
  durationMs: number;
  albumArtUrl?: string; // YouTube thumbnail
}

/** A track the user uploaded from their own device. Audio + art never leave the browser. */
export interface LocalTrack {
  source: "local";
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  /** object URL created from the IndexedDB-stored blob, valid for this session. */
  albumArtUrl?: string;
  addedAt: number;
}

export type Track = YoutubeTrack | LocalTrack;

/** A search-autocomplete result from Apple's free iTunes Search API — not yet
 * playable until matched to a YouTube video (see lib/youtube.ts, /api/resolve). */
export interface ItunesSearchResult {
  itunesId: number;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  artworkUrl?: string;
}

export function trackKey(track: Track): string {
  return track.source === "youtube" ? `youtube:${track.videoId}` : `local:${track.id}`;
}

/** Row shape for the shared Supabase `library` table (YouTube-sourced tracks only). */
export interface LibraryRow {
  id: string;
  video_id: string;
  title: string;
  artist: string;
  duration_ms: number;
  album_art_url: string | null;
  added_at: string;
}

export const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

/**
 * Validates an arbitrary JSON body as a YoutubeTrack before it's trusted
 * (e.g. written to Supabase in app/api/library/route.ts). No schema
 * library — this project deliberately has zero extra dependencies, and the
 * shape is simple enough that hand-rolling it is cheap and dependency-free.
 */
export function parseYoutubeTrack(input: unknown): YoutubeTrack | null {
  if (typeof input !== "object" || input === null) return null;
  const t = input as Record<string, unknown>;

  if (t.source !== "youtube") return null;
  if (typeof t.videoId !== "string" || !VIDEO_ID_PATTERN.test(t.videoId)) return null;

  if (typeof t.title !== "string") return null;
  const title = t.title.trim();
  if (title.length < 1 || title.length > 300) return null;

  if (typeof t.artist !== "string") return null;
  const artist = t.artist.trim();
  if (artist.length < 1 || artist.length > 300) return null;

  if (typeof t.durationMs !== "number" || !Number.isFinite(t.durationMs)) return null;
  if (t.durationMs <= 0 || t.durationMs > 24 * 60 * 60 * 1000) return null;

  if (t.albumArtUrl !== undefined) {
    if (typeof t.albumArtUrl !== "string") return null;
    if (t.albumArtUrl.length > 1000 || !t.albumArtUrl.startsWith("https://")) return null;
  }

  return {
    source: "youtube",
    videoId: t.videoId,
    title,
    artist,
    durationMs: t.durationMs,
    albumArtUrl: t.albumArtUrl as string | undefined,
  };
}

export function libraryRowToTrack(row: LibraryRow): YoutubeTrack {
  return {
    source: "youtube",
    videoId: row.video_id,
    title: row.title,
    artist: row.artist,
    durationMs: row.duration_ms,
    albumArtUrl: row.album_art_url ?? undefined,
  };
}

export type RepeatMode = "off" | "all" | "one";

export interface SyncedLyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResult {
  synced: SyncedLyricLine[] | null;
  plain: string | null;
}
