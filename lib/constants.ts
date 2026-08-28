export const SESSION_COOKIE_NAME = "mp_session";

/** How long a password-gate session stays valid. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** IndexedDB database name/version shared by lib/db/indexeddb.ts. */
export const IDB_NAME = "music-player";
export const IDB_VERSION = 1;
