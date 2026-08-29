"use client";

import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
} from "lucide-react";
import { usePlayerContext } from "./player-context";
import { formatDuration } from "@/lib/utils";
import type { RepeatMode } from "@/lib/types";

const NEXT_REPEAT_MODE: Record<RepeatMode, RepeatMode> = {
  off: "all",
  all: "one",
  one: "off",
};

export default function LeftPanel() {
  const {
    current,
    displayArt,
    artwork,
    isPlaying,
    currentTimeMs,
    durationMs,
    resolveStatus,
    resolveError,
    seekable,
    shuffle,
    setShuffle,
    repeatMode,
    setRepeatMode,
    volume,
    setVolume,
    togglePlay,
    next,
    prev,
    seekTo,
  } = usePlayerContext();

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = repeatMode === "one" ? Repeat1 : Repeat;
  const title = artwork?.title ?? current?.title;
  const artist = artwork?.artist ?? current?.artist;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 py-8">
      {/* Real square album art (iTunes, when a match is found) beats YouTube's
          16:9 thumbnail stretched/cropped into a square — see lib/itunes.ts. */}
      <div className="aspect-square w-[min(85%,65vh)] overflow-hidden rounded-2xl bg-white/5 shadow-2xl shadow-black/40 ring-1 ring-white/10">
        {displayArt ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayArt}
            alt={title ? `${title} 앨범 아트` : ""}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/20">
            <Music4Placeholder />
          </div>
        )}
      </div>

      <div className="w-full max-w-md text-center">
        <p className="truncate text-xl font-semibold text-white">{title ?? "재생 중인 곡 없음"}</p>
        <p className="mt-1 truncate text-sm text-white/60">{artist ?? " "}</p>
      </div>

      {resolveStatus === "resolving" && <p className="text-xs text-white/50">불러오는 중…</p>}
      {resolveStatus === "error" && <p className="text-xs text-red-300/90">{resolveError}</p>}

      <div className="w-full max-w-md">
        <input
          type="range"
          min={0}
          max={Math.max(durationMs, 1)}
          value={Math.min(currentTimeMs, durationMs)}
          onChange={(e) => seekTo(Number(e.target.value))}
          disabled={!seekable}
          title={seekable ? undefined : "첫 재생 중에는 이동할 수 없습니다"}
          className="mp-seekbar w-full disabled:opacity-40"
        />
        <div className="mt-1 flex justify-between text-[11px] text-white/40">
          <span>{formatDuration(currentTimeMs)}</span>
          <span>{formatDuration(durationMs)}</span>
        </div>
      </div>

      <div className="flex w-full max-w-md items-center justify-between">
        <button
          onClick={() => setShuffle(!shuffle)}
          className={`rounded-full p-1.5 transition ${shuffle ? "text-white" : "text-white/40 hover:text-white/70"}`}
          title="셔플"
        >
          <Shuffle className="h-3.5 w-3.5" />
        </button>

        <div className="flex items-center gap-4">
          <button onClick={prev} className="text-white/80 transition hover:text-white" title="이전 곡">
            <SkipBack className="h-5 w-5" fill="currentColor" />
          </button>
          <button
            onClick={togglePlay}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition hover:scale-105"
            title={isPlaying ? "일시정지" : "재생"}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" fill="currentColor" />
            ) : (
              <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
            )}
          </button>
          <button onClick={next} className="text-white/80 transition hover:text-white" title="다음 곡">
            <SkipForward className="h-5 w-5" fill="currentColor" />
          </button>
        </div>

        <button
          onClick={() => setRepeatMode(NEXT_REPEAT_MODE[repeatMode])}
          className={`rounded-full p-1.5 transition ${repeatMode !== "off" ? "text-white" : "text-white/40 hover:text-white/70"}`}
          title={`반복: ${repeatMode}`}
        >
          <RepeatIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex w-full max-w-md items-center gap-3">
        <VolumeIcon className="h-3.5 w-3.5 shrink-0 text-white/50" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="mp-seekbar w-full"
        />
      </div>
    </div>
  );
}

function Music4Placeholder() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-12 w-12">
      <path
        d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
