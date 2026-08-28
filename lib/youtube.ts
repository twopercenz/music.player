import "server-only";

export interface YoutubeCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  durationMs: number;
}

const NEGATIVE_KEYWORDS = ["live", "라이브", "cover", "커버", "reaction", "리액션", "mv reaction"];
const POSITIVE_KEYWORDS = ["official audio", "audio", "lyrics", "가사", "official mv", "mv"];

function parseIsoDuration(iso: string): number {
  // PT#H#M#S -> ms
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!match) return 0;
  const [, h, m, s] = match;
  const hours = Number(h ?? 0);
  const minutes = Number(m ?? 0);
  const seconds = Number(s ?? 0);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

async function youtubeFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set");

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

interface SearchListResponse {
  items: Array<{ id: { videoId: string }; snippet: { title: string; channelTitle: string } }>;
}

interface VideosListResponse {
  items: Array<{ id: string; contentDetails: { duration: string } }>;
}

async function searchYoutubeCandidates(
  query: string,
  { limit = 8 }: { limit?: number } = {},
): Promise<YoutubeCandidate[]> {
  const search = await youtubeFetch<SearchListResponse>("search", {
    part: "snippet",
    type: "video",
    videoCategoryId: "10", // Music
    maxResults: String(limit),
    q: query,
  });

  const ids = search.items.map((item) => item.id.videoId).filter(Boolean);
  if (ids.length === 0) return [];

  const videos = await youtubeFetch<VideosListResponse>("videos", {
    part: "contentDetails",
    id: ids.join(","),
  });
  const durationById = new Map(videos.items.map((v) => [v.id, parseIsoDuration(v.contentDetails.duration)]));

  return search.items
    .filter((item) => durationById.has(item.id.videoId))
    .map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      durationMs: durationById.get(item.id.videoId)!,
    }));
}

function scoreCandidate(candidate: YoutubeCandidate, expectedDurationMs: number): number {
  const lowerTitle = candidate.title.toLowerCase();
  let score = 0;

  // Duration closeness dominates: within 3s is near-certain, beyond 15s is probably wrong.
  const deltaSeconds = Math.abs(candidate.durationMs - expectedDurationMs) / 1000;
  score += Math.max(0, 30 - deltaSeconds * 2);

  for (const kw of POSITIVE_KEYWORDS) if (lowerTitle.includes(kw)) score += 3;
  for (const kw of NEGATIVE_KEYWORDS) if (lowerTitle.includes(kw)) score -= 15;

  return score;
}

/**
 * Finds a YouTube video to actually play for a track whose metadata came from
 * somewhere else (iTunes search results — see lib/itunes.ts). Ranks by
 * title-keyword hints and, mostly, duration closeness to the source track.
 * Pass `excludeVideoId` to get the next-best pick instead (e.g. a "다른 소스
 * 찾기" retry after a bad match or a dead/blocked video).
 */
export async function matchYoutubeTrack(
  artist: string,
  title: string,
  expectedDurationMs: number,
  excludeVideoId?: string,
): Promise<YoutubeCandidate | null> {
  const candidates = await searchYoutubeCandidates(`${artist} ${title}`);
  const pool = excludeVideoId ? candidates.filter((c) => c.videoId !== excludeVideoId) : candidates;
  if (pool.length === 0) return null;

  return pool.sort(
    (a, b) => scoreCandidate(b, expectedDurationMs) - scoreCandidate(a, expectedDurationMs),
  )[0];
}
