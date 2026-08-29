import "server-only";

/**
 * In-memory, per-key rate limiter. No external dependency (Redis etc.) —
 * this is a single-instance personal project, so a module-scope Map is
 * enough. Expired entries are swept lazily on lookup rather than via
 * setInterval, so this stays safe under serverless/edge restarts (no
 * dangling timer to leak or to fail to start).
 */
interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  if (entry.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { ok: true, retryAfterSec: 0 };
}

/** Clears a key's counter — call on a successful login so it doesn't count against the limit. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
