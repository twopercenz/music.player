"use client";

import { createContext, useContext, useRef } from "react";
import { usePlayer } from "@/hooks/use-player";
import { useLibrary } from "@/hooks/use-library";
import { useAnalyser } from "@/hooks/use-analyser";

type PlayerValue = ReturnType<typeof usePlayer> &
  ReturnType<typeof useLibrary> & {
    analyserRef: React.RefObject<AnalyserNode | null>;
  };

const PlayerContext = createContext<PlayerValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const player = usePlayer(audioRef);
  const library = useLibrary();
  const analyserRef = useAnalyser(audioRef);

  return (
    <PlayerContext.Provider value={{ ...player, ...library, analyserRef }}>
      {children}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="auto" />
    </PlayerContext.Provider>
  );
}

export function usePlayerContext() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayerContext must be used within a PlayerProvider");
  return ctx;
}
