"use client";

import { createContext, useContext, useMemo, useRef } from "react";
import { usePlayer } from "@/hooks/use-player";
import { useLibrary } from "@/hooks/use-library";
import { useAnalyser } from "@/hooks/use-analyser";

type PlayerValue = ReturnType<typeof usePlayer>["player"] &
  ReturnType<typeof useLibrary> & {
    analyserRef: React.RefObject<AnalyserNode | null>;
  };

interface PlayerTimeValue {
  currentTimeMs: number;
}

const PlayerContext = createContext<PlayerValue | null>(null);
// Split out from PlayerContext so that the ~4x/sec `timeupdate` tick
// (hooks/use-player.ts) only re-renders whoever actually reads the current
// time (the seek bar, the lyrics view) instead of the entire tree — see
// FIXES.md P2-1.
const PlayerTimeContext = createContext<PlayerTimeValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { player, currentTimeMs } = usePlayer(audioRef);
  const library = useLibrary();
  const analyserRef = useAnalyser(audioRef);

  // `player` and `library` are themselves memoized (hooks/use-player.ts,
  // hooks/use-library.ts) with currentTimeMs excluded, so this only produces
  // a new value when something other than playback time actually changed.
  const value = useMemo<PlayerValue>(
    () => ({ ...player, ...library, analyserRef }),
    [player, library, analyserRef],
  );
  const timeValue = useMemo<PlayerTimeValue>(() => ({ currentTimeMs }), [currentTimeMs]);

  return (
    <PlayerContext.Provider value={value}>
      <PlayerTimeContext.Provider value={timeValue}>
        {children}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} preload="auto" />
      </PlayerTimeContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayerContext() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayerContext must be used within a PlayerProvider");
  return ctx;
}

export function usePlayerTime() {
  const ctx = useContext(PlayerTimeContext);
  if (!ctx) throw new Error("usePlayerTime must be used within a PlayerProvider");
  return ctx.currentTimeMs;
}
