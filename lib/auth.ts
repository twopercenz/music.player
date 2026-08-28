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

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) throw new Error("SITE_PASSWORD is not set");
  return candidate === expected;
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
  const expectedSignature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(expiresAtStr),
  );
  return toHex(expectedSignature) === signatureHex;
}
