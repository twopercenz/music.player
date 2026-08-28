import { NextRequest, NextResponse } from "next/server";
import { fetchLyrics } from "@/lib/lyrics";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const artist = params.get("artist");
  const title = params.get("title");
  const durationMs = Number(params.get("durationMs"));

  if (!artist || !title || !Number.isFinite(durationMs)) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  try {
    const lyrics = await fetchLyrics(artist, title, durationMs);
    return NextResponse.json(lyrics);
  } catch (error) {
    console.error("lyrics fetch failed", error);
    return NextResponse.json({ synced: null, plain: null });
  }
}
