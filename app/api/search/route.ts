import { NextRequest, NextResponse } from "next/server";
import { searchItunesTracks } from "@/lib/itunes";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";

  try {
    const tracks = await searchItunesTracks(q);
    return NextResponse.json({ tracks });
  } catch (error) {
    console.error("search failed", error);
    return NextResponse.json({ error: "검색에 실패했습니다" }, { status: 502 });
  }
}
