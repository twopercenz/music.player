import "server-only";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Short-lived server-side cache for extracted audio, keyed by videoId. Lives
 * under the OS tmpdir, not the project — it's fine if it disappears on a
 * container restart, its only job is to avoid re-running yt-dlp+ffmpeg for
 * the same video twice in a row (see lib/extract.ts, app/api/extract/route.ts).
 * This is separate from (and upstream of) the client's IndexedDB cache,
 * which is what makes a *returning* visitor's replay avoid the network
 * entirely.
 */
const CACHE_DIR = join(tmpdir(), "music-player-cache");
const MAX_CACHE_BYTES = 500 * 1024 * 1024; // 500MB

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cachedFilePath(videoId: string): string {
  return join(CACHE_DIR, `${videoId}.mp3`);
}

/** Path to the cached file, or null if this video isn't cached. */
export function getCachedPath(videoId: string): string | null {
  const path = cachedFilePath(videoId);
  return existsSync(path) ? path : null;
}

/** Write target for a fresh extraction. Not visible to readers until commitCacheWrite(). */
export function getCacheWritePath(videoId: string): string {
  ensureCacheDir();
  return `${cachedFilePath(videoId)}.part`;
}

/** Atomically publishes a finished write (see getCacheWritePath) and runs LRU eviction. */
export function commitCacheWrite(videoId: string): void {
  try {
    renameSync(getCacheWritePath(videoId), cachedFilePath(videoId));
  } catch (err) {
    console.warn(`Failed to commit audio cache for ${videoId}: ${(err as Error).message}`);
    return;
  }
  evictIfOverBudget();
}

/** Drops a partial/failed write. Safe to call even if the .part file never existed. */
export function discardCacheWrite(videoId: string): void {
  const partPath = getCacheWritePath(videoId);
  try {
    if (existsSync(partPath)) unlinkSync(partPath);
  } catch (err) {
    console.warn(`Failed to discard partial audio cache for ${videoId}: ${(err as Error).message}`);
  }
}

function evictIfOverBudget(): void {
  ensureCacheDir();
  let entries: { path: string; size: number; atimeMs: number }[];
  try {
    entries = readdirSync(CACHE_DIR)
      .filter((name) => name.endsWith(".mp3"))
      .map((name) => {
        const path = join(CACHE_DIR, name);
        const stat = statSync(path);
        return { path, size: stat.size, atimeMs: stat.atimeMs };
      });
  } catch (err) {
    console.warn(`Failed to list audio cache dir: ${(err as Error).message}`);
    return;
  }

  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= MAX_CACHE_BYTES) return;

  entries.sort((a, b) => a.atimeMs - b.atimeMs); // least-recently-accessed first
  for (const entry of entries) {
    if (total <= MAX_CACHE_BYTES) break;
    try {
      unlinkSync(entry.path);
      total -= entry.size;
    } catch {
      // another request may have already removed it — fine, keep evicting
    }
  }
}
