import "server-only";
import type { LyricsResult, SyncedLyricLine } from "./types";

// lrclib.net — free, open, no-auth synced lyrics API. https://lrclib.net/docs
const BASE_URL = "https://lrclib.net/api";
const USER_AGENT = "music-player (personal project)";

interface LrcLibTrack {
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

function parseLrc(lrc: string): SyncedLyricLine[] {
  const lines: SyncedLyricLine[] = [];
  const lineRegex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;

  for (const rawLine of lrc.split("\n")) {
    const match = lineRegex.exec(rawLine);
    if (!match) continue;
    const [, mm, ss, ms, text] = match;
    const timeMs =
      Number(mm) * 60_000 + Number(ss) * 1000 + Number((ms ?? "0").padEnd(3, "0"));
    if (text.trim()) lines.push({ timeMs, text: text.trim() });
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

export async function fetchLyrics(
  artist: string,
  title: string,
  durationMs: number,
): Promise<LyricsResult> {
  const durationSeconds = Math.round(durationMs / 1000);

  const exact = await fetch(
    `${BASE_URL}/get?` +
      new URLSearchParams({
        artist_name: artist,
        track_name: title,
        duration: String(durationSeconds),
      }),
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
  );

  if (exact.ok) {
    const track = (await exact.json()) as LrcLibTrack;
    return toResult(track);
  }

  // Fall back to fuzzy search + closest duration match (exact `get` is strict about takes/edits).
  const search = await fetch(
    `${BASE_URL}/search?` + new URLSearchParams({ artist_name: artist, track_name: title }),
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
  );
  if (!search.ok) return { synced: null, plain: null };

  const results = (await search.json()) as Array<LrcLibTrack & { duration: number }>;
  if (results.length === 0) return { synced: null, plain: null };

  const closest = results.reduce((best, candidate) =>
    Math.abs(candidate.duration - durationSeconds) < Math.abs(best.duration - durationSeconds)
      ? candidate
      : best,
  );

  return toResult(closest);
}

function toResult(track: LrcLibTrack): LyricsResult {
  return {
    synced: track.syncedLyrics ? parseLrc(track.syncedLyrics) : null,
    plain: track.plainLyrics ?? null,
  };
}
