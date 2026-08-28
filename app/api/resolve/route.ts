import { NextRequest, NextResponse } from "next/server";
import { matchYoutubeTrack } from "@/lib/youtube";

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

  try {
    const match = await matchYoutubeTrack(artist, title, durationMs, excludeVideoId);
    return NextResponse.json({ videoId: match?.videoId ?? null });
  } catch (error) {
    console.error("resolve failed", error);
    return NextResponse.json({ error: "재생 가능한 소스를 찾지 못했습니다" }, { status: 502 });
  }
}
