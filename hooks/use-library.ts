"use client";

import { useCallback, useEffect, useState } from "react";
import { fetcher } from "@/lib/utils";
import { listLocalTracks, addLocalTrack, deleteLocalTrack } from "@/lib/db/indexeddb";
import type { LocalTrack, YoutubeTrack, Track } from "@/lib/types";

export function useLibrary() {
  const [youtubeTracks, setYoutubeTracks] = useState<YoutubeTrack[]>([]);
  const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [synced, local] = await Promise.all([
      fetcher<{ tracks: YoutubeTrack[] }>("/api/library").catch(() => ({ tracks: [] })),
      listLocalTracks().catch(() => []),
    ]);
    setYoutubeTracks(synced.tracks);
    setLocalTracks(local);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addYoutubeTrack = useCallback(
    async (track: YoutubeTrack) => {
      await fetch("/api/library", { method: "POST", body: JSON.stringify(track) });
      await refresh();
    },
    [refresh],
  );

  const removeYoutubeTrack = useCallback(
    async (videoId: string) => {
      await fetch(`/api/library?videoId=${encodeURIComponent(videoId)}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const uploadLocalFile = useCallback(
    async (file: File, meta: { title: string; artist: string; album?: string; durationMs: number }) => {
      await addLocalTrack({ file, ...meta });
      await refresh();
    },
    [refresh],
  );

  const removeLocalTrack = useCallback(
    async (id: string) => {
      await deleteLocalTrack(id);
      await refresh();
    },
    [refresh],
  );

  const library: Track[] = [...youtubeTracks, ...localTracks];

  return {
    library,
    youtubeTracks,
    localTracks,
    loading,
    refresh,
    addYoutubeTrack,
    removeYoutubeTrack,
    uploadLocalFile,
    removeLocalTrack,
  };
}
