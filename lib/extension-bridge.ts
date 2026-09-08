"use client";

import { EXTENSION_ID } from "@/lib/constants";

/**
 * Talks to the music.player Companion browser extension (extension/) — an
 * alternative to the server-side Invidious Companion path (lib/companion.ts
 * / app/api/extract) that resolves YouTube audio from inside the user's own
 * browser instead. It opens a real youtube.com/watch tab and reads the
 * playback URL out of it, so the request comes from the user's own
 * residential IP and real session — no cloud IP for YouTube's bot detection
 * to block. See extension/background.js for the actual extraction.
 *
 * Only Chromium-based browsers (Chrome, Edge, Brave, ...) expose
 * chrome.runtime — this degrades to "not available" everywhere else, and
 * lib/resolve-audio.ts falls back to /api/extract in that case.
 */

interface ChromeRuntimeLike {
  sendMessage(
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ): void;
  lastError?: { message?: string };
}

function getChromeRuntime(): ChromeRuntimeLike | null {
  const runtime = (globalThis as { chrome?: { runtime?: ChromeRuntimeLike } }).chrome?.runtime;
  return runtime?.sendMessage ? runtime : null;
}

function sendMessage(message: unknown, timeoutMs: number): Promise<unknown> {
  const runtime = getChromeRuntime();
  if (!runtime) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      runtime.sendMessage(EXTENSION_ID, message, (response) => {
        clearTimeout(timer);
        // "Could not establish connection" etc. — extension not installed.
        if (runtime.lastError) {
          finish(null);
          return;
        }
        finish(response ?? null);
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

let cachedAvailable: Promise<boolean> | null = null;

/** Whether the extension is installed and responding. Cached for the page's lifetime. */
export function isExtensionAvailable(): Promise<boolean> {
  if (!cachedAvailable) {
    cachedAvailable = sendMessage({ type: "ping" }, 800).then(
      (response) => !!(response as { ok?: boolean } | null)?.ok,
    );
  }
  return cachedAvailable;
}

export interface ExtensionResolvedAudio {
  url: string;
  mimeType: string;
}

/** Resolves a video's playable audio URL via the extension. Null on any failure. */
export async function resolveViaExtension(videoId: string): Promise<ExtensionResolvedAudio | null> {
  const response = (await sendMessage({ type: "resolve", videoId }, 20000)) as
    | { ok: true; url: string; mimeType: string }
    | { ok: false; error: string }
    | null;
  if (!response?.ok) return null;
  return { url: response.url, mimeType: response.mimeType };
}
