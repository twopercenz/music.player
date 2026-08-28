"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import type { LyricsResult } from "@/lib/types";

export default function LyricsView({
  lyrics,
  currentTimeMs,
}: {
  lyrics: LyricsResult | null;
  currentTimeMs: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLParagraphElement>(null);

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced?.length) return -1;
    let index = -1;
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].timeMs <= currentTimeMs) index = i;
      else break;
    }
    return index;
  }, [lyrics, currentTimeMs]);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  if (!lyrics?.synced?.length) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-white/50">
        {lyrics?.plain ? (
          <p className="whitespace-pre-line leading-relaxed">{lyrics.plain}</p>
        ) : (
          <p>가사를 찾을 수 없습니다</p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto px-8 py-[40vh] [mask-image:linear-gradient(to_bottom,transparent,black_15%,black_85%,transparent)]"
    >
      {lyrics.synced.map((line, i) => {
        const isActive = i === activeIndex;
        return (
          <motion.p
            key={line.timeMs + line.text}
            ref={isActive ? activeLineRef : undefined}
            animate={{
              opacity: isActive ? 1 : 0.35,
              scale: isActive ? 1 : 0.96,
            }}
            transition={{ duration: 0.3 }}
            className="my-3 origin-left text-2xl font-semibold tracking-tight text-white md:text-3xl"
          >
            {line.text}
          </motion.p>
        );
      })}
    </div>
  );
}
