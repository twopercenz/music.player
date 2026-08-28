"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { DominantColors } from "@/lib/color";

const DEFAULT_COLORS: DominantColors = { primary: "23 23 23", secondary: "5 5 5" };

export default function Background({ colors }: { colors: DominantColors | null }) {
  const { primary, secondary } = colors ?? DEFAULT_COLORS;
  const key = `${primary}-${secondary}`;

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-black">
      <AnimatePresence>
        <motion.div
          key={key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.6, ease: "easeInOut" }}
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(ellipse at top left, rgb(${primary} / 0.55), transparent 60%),
              radial-gradient(ellipse at bottom right, rgb(${secondary} / 0.55), transparent 60%),
              linear-gradient(to bottom right, rgb(${primary} / 0.25), rgb(${secondary} / 0.35))`,
          }}
        />
      </AnimatePresence>
      <div className="absolute inset-0 bg-black/30" />
    </div>
  );
}
