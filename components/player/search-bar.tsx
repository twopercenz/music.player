"use client";

import { useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { Search, X, Plus, Trash2, Loader2 } from "lucide-react";
import { usePlayerContext } from "./player-context";
import { fetcher, formatDuration } from "@/lib/utils";
import type { ItunesSearchResult, Track, YoutubeTrack } from "@/lib/types";

export default function SearchBar() {
  const { library, youtubeTracks, playTrack, addYoutubeTrack, removeYoutubeTrack, removeLocalTrack } =
    usePlayerContext();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<ItunesSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const runSearch = useDebouncedCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const { tracks } = await fetcher<{ tracks: ItunesSearchResult[] }>(
        `/api/search?q=${encodeURIComponent(q)}`,
      );
      setResults(tracks);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, 350);

  useEffect(() => {
    runSearch(query);
  }, [query, runSearch]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filteredLibrary = library.filter(
    (t) =>
      !query.trim() ||
      t.title.toLowerCase().includes(query.toLowerCase()) ||
      t.artist.toLowerCase().includes(query.toLowerCase()),
  );

  const handlePlayLibraryTrack = (track: Track) => {
    playTrack(track, library);
    setOpen(false);
  };

  // iTunes results aren't playable as-is — resolve to a YouTube video first.
  const resolveResult = async (result: ItunesSearchResult): Promise<YoutubeTrack | null> => {
    setResolvingId(result.itunesId);
    setResolveError(null);
    try {
      const { videoId } = await fetcher<{ videoId: string | null }>(
        `/api/resolve?${new URLSearchParams({
          artist: result.artist,
          title: result.title,
          durationMs: String(result.durationMs),
        })}`,
      );
      if (!videoId) {
        setResolveError("재생 가능한 소스를 찾지 못했습니다");
        return null;
      }
      return {
        source: "youtube",
        videoId,
        title: result.title,
        artist: result.artist,
        durationMs: result.durationMs,
        albumArtUrl: result.artworkUrl,
      };
    } catch {
      setResolveError("재생 가능한 소스를 찾지 못했습니다");
      return null;
    } finally {
      setResolvingId(null);
    }
  };

  const handlePlaySearchResult = async (result: ItunesSearchResult) => {
    const track = await resolveResult(result);
    if (!track) return;
    playTrack(track, [track]);
    void addYoutubeTrack(track);
    setOpen(false);
  };

  const handleAddSearchResult = async (result: ItunesSearchResult) => {
    const track = await resolveResult(result);
    if (track) void addYoutubeTrack(track);
  };

  return (
    <div ref={containerRef} className="pointer-events-auto relative mx-auto w-full max-w-xl">
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 backdrop-blur-md">
        <Search className="h-4 w-4 shrink-0 text-white/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="내 라이브러리 또는 Apple Music에서 검색"
          className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
        />
        {query && (
          <button onClick={() => setQuery("")} className="text-white/40 hover:text-white/70">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-white/10 bg-black/80 p-2 shadow-2xl backdrop-blur-xl">
          <Section title="내 라이브러리">
            {filteredLibrary.length === 0 && (
              <p className="px-3 py-2 text-xs text-white/30">
                {query ? "일치하는 곡이 없습니다" : "아직 저장된 곡이 없습니다"}
              </p>
            )}
            {filteredLibrary.map((track) => (
              <ResultRow
                key={track.source === "youtube" ? `yt-${track.videoId}` : `lo-${track.id}`}
                title={track.title}
                artist={track.artist}
                durationMs={track.durationMs}
                artworkUrl={track.albumArtUrl}
                onClick={() => handlePlayLibraryTrack(track)}
                onRemove={() =>
                  track.source === "youtube"
                    ? removeYoutubeTrack(track.videoId)
                    : removeLocalTrack(track.id)
                }
              />
            ))}
          </Section>

          {query.trim() && (
            <Section title="Apple Music에서 검색">
              {searching && <p className="px-3 py-2 text-xs text-white/30">검색 중…</p>}
              {!searching && results.length === 0 && (
                <p className="px-3 py-2 text-xs text-white/30">결과가 없습니다</p>
              )}
              {resolveError && <p className="px-3 py-2 text-xs text-red-300/90">{resolveError}</p>}
              {results
                .filter((r) => !youtubeTracks.some((t) => t.title === r.title && t.artist === r.artist))
                .map((result) => (
                  <ResultRow
                    key={result.itunesId}
                    title={result.title}
                    artist={result.artist}
                    durationMs={result.durationMs}
                    artworkUrl={result.artworkUrl}
                    resolving={resolvingId === result.itunesId}
                    onClick={() => handlePlaySearchResult(result)}
                    onAdd={() => handleAddSearchResult(result)}
                  />
                ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/30">
        {title}
      </p>
      {children}
    </div>
  );
}

function ResultRow({
  title,
  artist,
  durationMs,
  artworkUrl,
  resolving,
  onClick,
  onAdd,
  onRemove,
}: {
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl?: string;
  resolving?: boolean;
  onClick: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-white/10">
      <button
        onClick={onClick}
        disabled={resolving}
        className="flex flex-1 items-center gap-3 overflow-hidden text-left disabled:opacity-50"
      >
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white/10">
          {artworkUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-white">{title}</p>
          <p className="truncate text-xs text-white/50">{artist}</p>
        </div>
      </button>
      {resolving ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/40" />
      ) : (
        <span className="shrink-0 text-xs text-white/30">{formatDuration(durationMs)}</span>
      )}
      {onAdd && (
        <button
          onClick={onAdd}
          disabled={resolving}
          className="shrink-0 text-white/30 hover:text-white disabled:opacity-30"
          title="라이브러리에 추가"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 text-white/20 opacity-0 transition hover:text-white group-hover:opacity-100"
          title="라이브러리에서 삭제"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
