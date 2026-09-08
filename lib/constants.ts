export const SESSION_COOKIE_NAME = "mp_session";

/** How long a password-gate session stays valid. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** IndexedDB database name/version shared by lib/db/indexeddb.ts. */
export const IDB_NAME = "music-player";
export const IDB_VERSION = 1;

/**
 * Stable Chrome extension ID for extension/ (music.player Companion) — see
 * lib/extension-bridge.ts. Derived from extension/manifest.json's "key"
 * field (the extension's public key), so it stays the same across
 * "load unpacked" reloads regardless of which machine/path loads it — the
 * matching private key lives at extension/extension-key.pem, gitignored,
 * only needed if this ever gets packaged/signed for real distribution.
 */
export const EXTENSION_ID = "kkbbdkllfhgoidgpjfgehjponjlkelli";
