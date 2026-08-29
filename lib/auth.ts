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
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(expiresAt)));
  return `${expiresAt}.${toHex(signature)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expiresAtStr, signatureHex] = token.split(".");
  if (!expiresAtStr || !signatureHex) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const key = await hmacKey();
  // crypto.subtle.verify does a constant-time comparison internally, unlike
  // signing-and-comparing-hex-strings-with-=== (a theoretical oracle for
  // forging a signature).
  const sigBytes = Uint8Array.from(signatureHex.match(/../g) ?? [], (h) => parseInt(h, 16));
  if (sigBytes.length !== 32) return false;
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(expiresAtStr));
}
