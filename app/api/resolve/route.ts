import { NextRequest, NextResponse } from "next/server";
import { matchYoutubeTrack } from "@/lib/youtube";
import { buildResolveCacheKey, getCachedResolve, setCachedResolve } from "@/lib/resolve-cache";

/**
 * Given a track's metadata (from an iTunes search result), finds a YouTube
 * video to actually play it from. Pass `excludeVideoId` to skip a video that
 * turned out to be wrong and get the next-best candidate instead.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const artist = params.get("artist");
  const title = params.get("title");
  const durationMs = Number(params.get("durationMs"));
  const excludeVideoId = params.get("excludeVideoId") ?? undefined;

  if (!artist || !title || !Number.isFinite(durationMs)) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  const cacheKey = buildResolveCacheKey(artist, title, durationMs);

  // excludeVideoId means the cached match turned out to be wrong (dead/blocked
  // video, bad match) — skip the cache and re-match instead of returning the
  // same bad videoId again.
  if (!excludeVideoId) {
    const cached = await getCachedResolve(cacheKey);
    if (cached) return NextResponse.json({ videoId: cached });
  }

  try {
    const match = await matchYoutubeTrack(artist, title, durationMs, excludeVideoId);
    if (match) void setCachedResolve(cacheKey, match.videoId);
    return NextResponse.json({ videoId: match?.videoId ?? null });
  } catch (error) {
    console.error("resolve failed", error);
    const message = error instanceof Error ? error.message : "재생 가능한 소스를 찾지 못했습니다";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
