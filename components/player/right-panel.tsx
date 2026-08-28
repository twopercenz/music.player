"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Waves, Mic2 } from "lucide-react";
import { usePlayerContext } from "./player-context";
import LyricsView from "./lyrics-view";
import Visualizer from "./visualizer";

export default function RightPanel() {
  const {
    lyrics,
    currentTimeMs,
    effectiveRightPanelMode,
    rightPanelMode,
    setRightPanelMode,
    analyserRef,
    dominantColors,
  } = usePlayerContext();

  const hasLyrics = !!lyrics?.synced?.length;

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex justify-end p-4">
        <button
          onClick={() => setRightPanelMode(rightPanelMode === "lyrics" ? "visualizer" : "lyrics")}
          disabled={!hasLyrics}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 backdrop-blur-md transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          title={hasLyrics ? "가사 / 비주얼라이저 전환" : "이 곡의 가사를 찾지 못했습니다"}
        >
          {effectiveRightPanelMode === "lyrics" ? (
            <>
              <Waves className="h-3.5 w-3.5" /> 비주얼라이저로
            </>
          ) : (
            <>
              <Mic2 className="h-3.5 w-3.5" /> 가사로
            </>
          )}
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {effectiveRightPanelMode === "lyrics" ? (
            <motion.div
              key="lyrics"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              <LyricsView lyrics={lyrics} currentTimeMs={currentTimeMs} />
            </motion.div>
          ) : (
            <motion.div
              key="visualizer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              <Visualizer analyserRef={analyserRef} accentColor={dominantColors} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
