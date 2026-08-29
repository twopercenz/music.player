import { SESSION_MAX_AGE_SECONDS } from "./constants";

// Stateless password-gate session: no accounts, no DB — just a signed cookie.
// Uses Web Crypto (not node:crypto) so this also works from Edge middleware.

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Mixed into the signed session message so that changing SITE_PASSWORD
// invalidates every previously-issued cookie — otherwise a 30-day session
// token keeps working even after the password it was granted under changes.
async function passwordFingerprint(): Promise<string> {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) throw new Error("SITE_PASSWORD is not set");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected));
  return toHex(digest).slice(0, 16);
}

// `candidate === expected` short-circuits on the first differing byte, which
// leaks how many leading characters were guessed correctly via response
// timing. HMAC both sides first (fixed-length output regardless of input
// length — also hides length) and compare those in constant time.
export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) throw new Error("SITE_PASSWORD is not set");
  const key = await hmacKey();
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(candidate)),
    crypto.subtle.sign("HMAC", key, enc.encode(expected)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

/** Builds a `{expiresAt}.{signature}` cookie value good for SESSION_MAX_AGE_SECONDS. */
export async function createSessionToken(): Promise<string> {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const key = await hmacKey();
  const message = `${expiresAt}.${await passwordFingerprint()}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return `${expiresAt}.${toHex(signature)}`;
}

// Wrapped in try/catch: hmacKey()/passwordFingerprint() throw if
// SESSION_SECRET/SITE_PASSWORD aren't set, and this runs in middleware for
// every request — an unhandled throw there would 500 the entire app,
// including the /login page itself, on one missing env var. A config error
// should send the visitor to the login screen just like a bad token does;
// it's still logged so it isn't silently swallowed.
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  try {
    if (!token) return false;
    const [expiresAtStr, signatureHex] = token.split(".");
    if (!expiresAtStr || !signatureHex) return false;

    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

    const key = await hmacKey();
    const message = `${expiresAtStr}.${await passwordFingerprint()}`;
    // crypto.subtle.verify does a constant-time comparison internally,
    // unlike signing-and-comparing-hex-strings-with-=== (a theoretical
    // oracle for forging a signature).
    const sigBytes = Uint8Array.from(signatureHex.match(/../g) ?? [], (h) => parseInt(h, 16));
    if (sigBytes.length !== 32) return false;
    return await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(message));
  } catch (err) {
    console.error("verifySessionToken failed", err);
    return false;
  }
}
