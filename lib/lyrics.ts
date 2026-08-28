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
    // lrclib has multiple community submissions per song, and `get` returns
    // just one of them — it's sometimes a metadata-only stub with no
    // syncedLyrics *or* plainLyrics, even though other submissions of the
    // exact same song (findable via `search`) do have them. Don't accept an
    // empty stub as "no lyrics" — fall through to search for a real one.
    if (track.syncedLyrics || track.plainLyrics) return toResult(track);
  }

  // Fall back to fuzzy search (exact `get` is strict about takes/edits/duration).
  const search = await fetch(
    `${BASE_URL}/search?` + new URLSearchParams({ artist_name: artist, track_name: title }),
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
  );
  if (!search.ok) return { synced: null, plain: null };

  const results = (await search.json()) as Array<LrcLibTrack & { duration: number }>;
  if (results.length === 0) return { synced: null, plain: null };

  // Prefer a submission that actually has lyrics over one that's merely the
  // closest duration match but empty — a stub a few results away is worse
  // than a real submission a couple seconds off.
  const best = results.reduce((best, candidate) => {
    const bestTier = best.syncedLyrics ? 0 : best.plainLyrics ? 1 : 2;
    const candidateTier = candidate.syncedLyrics ? 0 : candidate.plainLyrics ? 1 : 2;
    if (candidateTier !== bestTier) return candidateTier < bestTier ? candidate : best;

    const bestDelta = Math.abs(best.duration - durationSeconds);
    const candidateDelta = Math.abs(candidate.duration - durationSeconds);
    return candidateDelta < bestDelta ? candidate : best;
  });

  return toResult(best);
}

function toResult(track: LrcLibTrack): LyricsResult {
  return {
    synced: track.syncedLyrics ? parseLrc(track.syncedLyrics) : null,
    plain: track.plainLyrics ?? null,
  };
}
