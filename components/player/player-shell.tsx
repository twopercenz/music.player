"use client";

import { usePlayerContext } from "./player-context";
import Background from "./background";
import LeftPanel from "./left-panel";
import RightPanel from "./right-panel";
import SearchBar from "./search-bar";
import UploadButton from "./upload-button";

export default function PlayerShell() {
  const { dominantColors } = usePlayerContext();

  return (
    <div className="relative h-screen w-full overflow-hidden text-white">
      <Background colors={dominantColors} />

      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-4 md:p-6">
        <SearchBar />
        <UploadButton />
      </div>

      <div className="grid h-full grid-cols-1 md:grid-cols-2">
        <div className="min-h-0 pt-16 md:pt-0">
          <LeftPanel />
        </div>
        <div className="min-h-0 border-t border-white/5 md:border-l md:border-t-0">
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
