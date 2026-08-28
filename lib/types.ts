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
