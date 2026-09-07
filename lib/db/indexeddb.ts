"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { IDB_NAME, IDB_VERSION } from "@/lib/constants";
import type { LocalTrack } from "@/lib/types";

interface LocalTrackRecord {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  addedAt: number;
  fileBlob: Blob;
  artBlob?: Blob;
}

interface AudioCacheRecord {
  videoId: string;
  blob: Blob;
  cachedAt: number;
}

interface MusicPlayerDB extends DBSchema {
  localTracks: { key: string; value: LocalTrackRecord };
  audioCache: { key: string; value: AudioCacheRecord };
}

let dbPromise: Promise<IDBPDatabase<MusicPlayerDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<MusicPlayerDB>(IDB_NAME, IDB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("localTracks")) {
          db.createObjectStore("localTracks", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("audioCache")) {
          db.createObjectStore("audioCache", { keyPath: "videoId" });
        }
      },
    });
  }
  return dbPromise;
}

// ---- Locally-uploaded tracks (audio + art never leave the browser) ----

export async function addLocalTrack(params: {
  file: File;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  artBlob?: Blob;
}): Promise<LocalTrack> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const record: LocalTrackRecord = {
    id,
    title: params.title,
    artist: params.artist,
    album: params.album,
    durationMs: params.durationMs,
    addedAt: Date.now(),
    fileBlob: params.file,
    artBlob: params.artBlob,
  };
  await db.put("localTracks", record);
  return recordToTrack(record);
}

export async function listLocalTracks(): Promise<LocalTrack[]> {
  const db = await getDb();
  const records = await db.getAll("localTracks");
  return records.sort((a, b) => b.addedAt - a.addedAt).map(recordToTrack);
}

export async function deleteLocalTrack(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("localTracks", id);

  const cachedArtUrl = artUrlCache.get(id);
  if (cachedArtUrl) {
    URL.revokeObjectURL(cachedArtUrl);
    artUrlCache.delete(id);
  }
}

/** Object URL for playback — caller should revoke it when the track changes. */
export async function getLocalTrackAudioUrl(id: string): Promise<string | null> {
  const db = await getDb();
  const record = await db.get("localTracks", id);
  return record ? URL.createObjectURL(record.fileBlob) : null;
}

// listLocalTracks() runs (via hooks/use-library.ts's refresh()) on every add
// or delete, and recordToTrack() used to call URL.createObjectURL() fresh
// each time for every track's art — nobody ever revokes those, so the blob
// URL count grows unbounded the more the library is used. Memoizing by id
// means an unchanged track reuses the same URL instead of leaking a new one.
const artUrlCache = new Map<string, string>();

function recordToTrack(record: LocalTrackRecord): LocalTrack {
  let albumArtUrl = artUrlCache.get(record.id);
  if (!albumArtUrl && record.artBlob) {
    albumArtUrl = URL.createObjectURL(record.artBlob);
    artUrlCache.set(record.id, albumArtUrl);
  }

  return {
    source: "local",
    id: record.id,
    title: record.title,
    artist: record.artist,
    album: record.album,
    durationMs: record.durationMs,
    albumArtUrl,
    addedAt: record.addedAt,
  };
}

// ---- Cache for audio extracted server-side from YouTube (never persisted server-side) ----

const MAX_AUDIO_CACHE_BYTES = 1024 * 1024 * 1024; // 1GB

export async function getCachedAudioUrl(videoId: string): Promise<string | null> {
  const db = await getDb();
  const record = await db.get("audioCache", videoId);
  return record ? URL.createObjectURL(record.blob) : null;
}

export async function cacheAudio(videoId: string, blob: Blob): Promise<string> {
  const db = await getDb();
  await db.put("audioCache", { videoId, blob, cachedAt: Date.now() });
  await evictAudioCacheIfOverBudget(db);
  return URL.createObjectURL(blob);
}

async function evictAudioCacheIfOverBudget(db: IDBPDatabase<MusicPlayerDB>): Promise<void> {
  const records = await db.getAll("audioCache");
  let total = records.reduce((sum, record) => sum + record.blob.size, 0);
  if (total <= MAX_AUDIO_CACHE_BYTES) return;

  const oldestFirst = records.sort((a, b) => a.cachedAt - b.cachedAt);
  for (const record of oldestFirst) {
    if (total <= MAX_AUDIO_CACHE_BYTES) break;
    await db.delete("audioCache", record.videoId);
    total -= record.blob.size;
  }
}
