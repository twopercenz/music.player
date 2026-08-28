import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { libraryRowToTrack, type LibraryRow, type YoutubeTrack } from "@/lib/types";

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("library")
    .select("*")
    .order("added_at", { ascending: false });

  if (error) {
    console.error("library list failed", error);
    return NextResponse.json({ error: "라이브러리를 불러오지 못했습니다" }, { status: 502 });
  }

  return NextResponse.json({ tracks: (data as LibraryRow[]).map(libraryRowToTrack) });
}

export async function POST(request: NextRequest) {
  const track = (await request.json().catch(() => null)) as YoutubeTrack | null;
  if (!track || track.source !== "youtube") {
    return NextResponse.json({ error: "invalid track" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("library").upsert(
    {
      video_id: track.videoId,
      title: track.title,
      artist: track.artist,
      duration_ms: track.durationMs,
      album_art_url: track.albumArtUrl ?? null,
    },
    { onConflict: "video_id" },
  );

  if (error) {
    console.error("library add failed", error);
    return NextResponse.json({ error: "라이브러리에 추가하지 못했습니다" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId");
  if (!videoId) return NextResponse.json({ error: "missing videoId" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("library").delete().eq("video_id", videoId);

  if (error) {
    console.error("library delete failed", error);
    return NextResponse.json({ error: "삭제하지 못했습니다" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
