"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveTrackAudio } from "@/lib/resolve-audio";
import { cacheAudio } from "@/lib/db/indexeddb";
import { fetcher } from "@/lib/utils";
import useLocalStorage from "@/lib/hooks/use-local-storage";
import { extractDominantColors, type DominantColors } from "@/lib/color";
import type { LyricsResult, RepeatMode, Track } from "@/lib/types";
import { trackKey } from "@/lib/types";

export type ResolveStatus = "idle" | "resolving" | "ready" | "error";
export type RightPanelMode = "lyrics" | "visualizer";

interface ArtworkEnrichment {
  title: string;
  artist: string;
  artworkUrl: string;
}

export function usePlayer(audioRef: React.RefObject<HTMLAudioElement>) {
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [resolveStatus, setResolveStatus] = useState<ResolveStatus>("idle");
  const [resolveError, setResolveError] = useState<string | null>(null);
  // Only a cache hit (a blob: URL — local file or IndexedDB audio cache) is
  // seekable: the live extraction stream from /api/extract has no
  // Content-Length/Range support, so <audio> can't jump ahead of what's
  // already buffered.
  const [seekable, setSeekable] = useState(false);

  const [volume, setVolume] = useLocalStorage("mp:volume", 0.8);
  const [shuffle, setShuffle] = useLocalStorage("mp:shuffle", false);
  const [repeatMode, setRepeatMode] = useLocalStorage<RepeatMode>("mp:repeat", "off");
  const [rightPanelMode, setRightPanelMode] = useLocalStorage<RightPanelMode>(
    "mp:right-panel",
    "visualizer",
  );

  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [dominantColors, setDominantColors] = useState<DominantColors | null>(null);
  const [artwork, setArtwork] = useState<ArtworkEnrichment | null>(null);

  const objectUrlRef = useRef<string | null>(null);
  const playedShuffleIndices = useRef<Set<number>>(new Set());

  const current = currentIndex !== null ? queue[currentIndex] : null;

  // Keep the <audio> element's volume in sync.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [audioRef, volume]);

  // `load` takes the queue explicitly rather than closing over `queue` state, so
  // callers can set a new queue and load from it in the same tick (no stale reads).
  const load = useCallback(
    async (tracks: Track[], index: number) => {
      const track = tracks[index];
      const audio = audioRef.current;
      if (!track || !audio) return;

      // Stop the outgoing track immediately — resolving the new one (an
      // extraction can take several seconds) used to leave the previous
      // song audibly playing under the new track's title/artwork/lyrics
      // the whole time. Clearing src also cancels any in-flight buffering
      // of the outgoing stream instead of leaving it downloading in the
      // background.
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      setIsPlaying(false);
      setCurrentTimeMs(0);
      setSeekable(false);

      setCurrentIndex(index);
      setResolveStatus("resolving");
      setResolveError(null);

      try {
        const resolved = await resolveTrackAudio(track);
        const isCacheHit = resolved.url.startsWith("blob:");

        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = isCacheHit ? resolved.url : null;

        audio.src = resolved.url;
        setSeekable(isCacheHit);

        // Kick off a background copy into the IndexedDB cache so a replay
        // (this session or after a reload) skips the network entirely. By
        // the time this fetch reaches the server, the extraction above has
        // usually already populated the server's own tmp cache, so it reads
        // a file instead of running yt-dlp+ffmpeg a second time.
        if (track.source === "youtube" && !isCacheHit) {
          void fetch(resolved.url)
            .then((r) => (r.ok ? r.blob() : null))
            .then((b) => b && cacheAudio(track.videoId, b))
            .catch(() => {});
        }

        await audio.play();
        setIsPlaying(true);
        setResolveStatus("ready");
      } catch (error) {
        console.error("failed to resolve track", error);
        setResolveStatus("error");
        setResolveError(error instanceof Error ? error.message : "재생에 실패했습니다");
      }
    },
    [audioRef],
  );

  const playQueue = useCallback(
    (tracks: Track[], startIndex = 0) => {
      setQueue(tracks);
      playedShuffleIndices.current = new Set([startIndex]);
      void load(tracks, startIndex);
    },
    [load],
  );

  const playTrack = useCallback(
    (track: Track, context?: Track[]) => {
      const tracks = context ?? [track];
      const startIndex = Math.max(
        tracks.findIndex((t) => trackKey(t) === trackKey(track)),
        0,
      );
      setQueue(tracks);
      playedShuffleIndices.current = new Set([startIndex]);
      void load(tracks, startIndex);
    },
    [load],
  );

  const pickNextIndex = useCallback(() => {
    if (queue.length === 0 || currentIndex === null) return null;
    if (repeatMode === "one") return currentIndex;

    if (shuffle) {
      const unplayed = queue
        .map((_, i) => i)
        .filter((i) => !playedShuffleIndices.current.has(i));
      if (unplayed.length === 0) {
        if (repeatMode === "all") {
          playedShuffleIndices.current = new Set();
          return Math.floor(Math.random() * queue.length);
        }
        return null;
      }
      return unplayed[Math.floor(Math.random() * unplayed.length)];
    }

    if (currentIndex + 1 < queue.length) return currentIndex + 1;
    return repeatMode === "all" ? 0 : null;
  }, [queue, currentIndex, repeatMode, shuffle]);

  const next = useCallback(() => {
    const nextIndex = pickNextIndex();
    if (nextIndex === null) {
      setIsPlaying(false);
      return;
    }
    playedShuffleIndices.current.add(nextIndex);
    void load(queue, nextIndex);
  }, [pickNextIndex, load, queue]);

  const prev = useCallback(() => {
    if (currentIndex === null) return;
    if ((audioRef.current?.currentTime ?? 0) > 3) {
      if (audioRef.current) audioRef.current.currentTime = 0;
      return;
    }
    const prevIndex = shuffle
      ? Math.floor(Math.random() * queue.length)
      : Math.max(currentIndex - 1, 0);
    void load(queue, prevIndex);
  }, [audioRef, currentIndex, queue, shuffle]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) {
      void audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [audioRef]);

  const seekTo = useCallback(
    (ms: number) => {
      if (audioRef.current) audioRef.current.currentTime = ms / 1000;
      setCurrentTimeMs(ms);
    },
    [audioRef],
  );

  // Sync currentTime from the actual <audio> element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTimeMs(audio.currentTime * 1000);
    const onEnded = () => next();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [audioRef, next]);

  // Whenever the current track changes: look up real square album art on
  // iTunes (YouTube thumbnails are 16:9 — see lib/itunes.ts) for the
  // background's dominant-color extraction, and fetch lyrics — in parallel,
  // not chained, since search results' title/artist are already clean
  // iTunes metadata (see search-bar.tsx) and don't need to wait on the
  // artwork lookup to be usable for a lyrics query. Nothing here is
  // persisted — it's display-only, so a bad or missing match just falls
  // back gracefully.
  useEffect(() => {
    if (!current) {
      setLyrics(null);
      setDominantColors(null);
      setArtwork(null);
      return;
    }

    let cancelled = false;
    setArtwork(null);
    setLyrics(null);

    fetcher<{ match: ArtworkEnrichment | null }>(
      `/api/artwork?${new URLSearchParams({
        artist: current.artist,
        title: current.title,
        durationMs: String(current.durationMs),
      })}`,
    )
      .catch((error) => {
        console.error("artwork lookup failed", error);
        return { match: null };
      })
      .then(({ match }) => {
        if (cancelled) return;
        setArtwork(match);

        const artForColor = match?.artworkUrl ?? current.albumArtUrl;
        if (artForColor) {
          extractDominantColors(artForColor).then((c) => !cancelled && setDominantColors(c));
        } else {
          setDominantColors(null);
        }
      });

    fetcher<LyricsResult>(
      `/api/lyrics?${new URLSearchParams({
        artist: current.artist,
        title: current.title,
        durationMs: String(current.durationMs),
      })}`,
    )
      .then((result) => !cancelled && setLyrics(result))
      .catch((error) => {
        console.error("lyrics lookup failed", error);
        if (!cancelled) setLyrics({ synced: null, plain: null });
      });

    return () => {
      cancelled = true;
    };
  }, [current]);

  const effectiveRightPanelMode: RightPanelMode = lyrics?.synced?.length
    ? rightPanelMode
    : "visualizer";

  const displayArt = artwork?.artworkUrl ?? current?.albumArtUrl;

  return {
    queue,
    current,
    currentIndex,
    isPlaying,
    currentTimeMs,
    durationMs: current?.durationMs ?? 0,
    resolveStatus,
    resolveError,
    seekable,
    volume,
    setVolume,
    shuffle,
    setShuffle,
    repeatMode,
    setRepeatMode,
    rightPanelMode,
    setRightPanelMode,
    effectiveRightPanelMode,
    lyrics,
    dominantColors,
    artwork,
    displayArt,
    playTrack,
    playQueue,
    togglePlay,
    next,
    prev,
    seekTo,
  };
}
