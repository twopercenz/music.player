import { NextRequest, NextResponse } from "next/server";
import { findItunesMatch } from "@/lib/itunes";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const artist = params.get("artist");
  const title = params.get("title");
  const durationMs = Number(params.get("durationMs"));

  if (!artist || !title || !Number.isFinite(durationMs)) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  try {
    const match = await findItunesMatch(artist, title, durationMs);
    return NextResponse.json({ match });
  } catch (error) {
    console.error("itunes lookup failed", error);
    return NextResponse.json({ match: null });
  }
}
