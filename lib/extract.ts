import "server-only";
import { spawn } from "node:child_process";
import { PassThrough, Readable } from "node:stream";
import { createWriteStream, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitCacheWrite, discardCacheWrite, getCacheWritePath } from "./audio-cache";

/**
 * YouTube increasingly answers yt-dlp with "Sign in to confirm you're not a
 * bot" — especially from datacenter IPs (Render, Fly.io, etc. all qualify).
 * The practical fix is real cookies from a logged-in session:
 *   - YTDLP_COOKIES_FILE: path to a cookies.txt (Netscape format) file —
 *     pass the exported file straight through to yt-dlp, no copy-pasting
 *     content into an env var. On Render, upload it as a Secret File and
 *     point this at its mount path. See README for how to export the file.
 *   - YTDLP_COOKIES_FROM_BROWSER: browser name (e.g. "chrome") — only useful
 *     for local dev, where yt-dlp runs on the same machine as your browser.
 *
 * yt-dlp doesn't just read the cookies file — it writes the (possibly
 * refreshed) jar back to the same path when it's done. Render's Secret
 * Files are mounted read-only (e.g. /etc/secrets/cookies.txt), so writing
 * straight to YTDLP_COOKIES_FILE throws EROFS and crashes the whole
 * process *after* extraction already ran, masking the real error. So we
 * copy it once to a writable tmp path per server instance and point
 * yt-dlp at that copy instead.
 */
let writableCookiesFile: string | null = null;

function getWritableCookiesFile(sourcePath: string): string | null {
  if (writableCookiesFile && existsSync(writableCookiesFile)) return writableCookiesFile;
  try {
    const dest = join(tmpdir(), "yt-dlp-cookies.txt");
    copyFileSync(sourcePath, dest);
    writableCookiesFile = dest;
    return dest;
  } catch (err) {
    console.warn(`Failed to copy YTDLP_COOKIES_FILE to a writable path: ${(err as Error).message}`);
    return null;
  }
}

function getCookieArgs(): string[] {
  const cookiesFile = process.env.YTDLP_COOKIES_FILE;
  if (cookiesFile) {
    if (!existsSync(cookiesFile)) {
      console.warn(`YTDLP_COOKIES_FILE is set to "${cookiesFile}" but that file doesn't exist`);
    } else {
      const writablePath = getWritableCookiesFile(cookiesFile);
      if (writablePath) return ["--cookies", writablePath];
    }
  }

  const browser = process.env.YTDLP_COOKIES_FROM_BROWSER;
  if (browser) return ["--cookies-from-browser", browser];

  return [];
}

// /api/extract spawns yt-dlp (network-bound download) + ffmpeg (CPU-bound
// encode) per request with no cap — a handful of concurrent tabs is enough
// to take down a free-tier container. Cap it globally per server instance.
const MAX_CONCURRENT_EXTRACTIONS = 2;
let activeExtractions = 0;

export class TooManyExtractionsError extends Error {
  constructor() {
    super("동시에 처리할 수 있는 추출 수를 초과했습니다. 잠시 후 다시 시도해주세요.");
    this.name = "TooManyExtractionsError";
  }
}

// app/api/extract/route.ts "probes" (?probe=1) a fresh videoId before ever
// setting <audio src="...">, so a real yt-dlp/ffmpeg failure (private video,
// etc.) surfaces its actual message instead of the browser's generic
// NotSupportedError. That probe has to run the *real* extraction to get a
// real answer — but the <audio> element's own request lands microseconds
// later for the exact same videoId, and the cache isn't populated yet
// (extraction is still streaming). Rather than let that spawn a second
// yt-dlp+ffmpeg pair, the probe's still-running extraction is stashed here
// and handed to the very next non-probe request for the same videoId.
interface PendingExtraction {
  stream: ReadableStream<Uint8Array>;
  abort: () => void;
}
const pendingExtractions = new Map<string, PendingExtraction>();

/** Takes (and removes) a stashed extraction for videoId, if a probe left one. */
export function claimPendingStream(videoId: string): PendingExtraction | null {
  const pending = pendingExtractions.get(videoId);
  if (!pending) return null;
  pendingExtractions.delete(videoId);
  return pending;
}

function stashForReuse(videoId: string, pending: PendingExtraction): void {
  pendingExtractions.set(videoId, pending);
  // If nobody claims it — the probe succeeded but the user skipped away
  // before <audio src> ever got set — ffmpeg would otherwise keep streaming
  // into a PassThrough nothing is draining, piling up in memory forever.
  setTimeout(() => {
    if (pendingExtractions.get(videoId) === pending) {
      pendingExtractions.delete(videoId);
      pending.abort();
    }
  }, 15_000);
}

function summarizeYtDlpError(stderr: string): string {
  if (/sign in to confirm/i.test(stderr)) {
    return "YouTube가 봇 감지로 요청을 막았습니다. YTDLP_COOKIES_FILE 설정이 필요합니다 (README 참고).";
  }
  if (/page needs to be reloaded/i.test(stderr)) {
    return "YouTube 쪽 일시적 오류입니다 (yt-dlp 추출기 이슈). 잠시 후 다시 시도해보세요.";
  }
  if (/private video/i.test(stderr)) return "비공개 영상이라 재생할 수 없습니다.";
  if (/video unavailable/i.test(stderr)) return "삭제되었거나 재생할 수 없는 영상입니다.";
  if (/not available in your country|geo/i.test(stderr)) return "지역 제한으로 재생할 수 없는 영상입니다.";
  return "오디오 추출에 실패했습니다.";
}

/**
 * Extracts the audio of a YouTube video as an mp3 byte stream, by piping
 * `yt-dlp` (best audio track, raw) into `ffmpeg` (transcode to mp3).
 *
 * Requires the `yt-dlp` and `ffmpeg` binaries to be on PATH — see Dockerfile.
 * The stream is teed to a short-lived server-side tmp cache as it goes (see
 * lib/audio-cache.ts) in addition to the caller (api/extract) streaming it
 * to the client, which caches its own copy in IndexedDB.
 */
export async function extractAudioStream(
  videoId: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const { stream } = await extractAudioStreamInternal(videoId, signal);
  return stream;
}

/** Runs a real extraction purely to confirm success/failure, then stashes the
 * still-streaming result for claimPendingStream() instead of discarding it —
 * see the PendingExtraction comment above for why. */
export async function extractAudioStreamForProbe(videoId: string, signal?: AbortSignal): Promise<void> {
  const pending = await extractAudioStreamInternal(videoId, signal);
  stashForReuse(videoId, pending);
}

async function extractAudioStreamInternal(
  videoId: string,
  signal?: AbortSignal,
): Promise<PendingExtraction> {
  if (activeExtractions >= MAX_CONCURRENT_EXTRACTIONS) {
    throw new TooManyExtractionsError();
  }
  activeExtractions++;
  let slotReleased = false;
  const releaseSlot = () => {
    if (slotReleased) return;
    slotReleased = true;
    activeExtractions--;
  };

  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const ytDlp = spawn("yt-dlp", [
    // "/best" fallback matters here: the android/ios clients below often don't
    // expose a pure audio-only format the way the web client does, so a bare
    // "bestaudio" can fail with "Requested format is not available" even
    // though the video itself is fine — "best" (a combined video+audio
    // stream) covers that gap, and ffmpeg's -vn below strips the video back
    // out anyway, so the end result is identical either way.
    "-f",
    "bestaudio/best",
    "--no-playlist",
    "--no-part",
    // yt-dlp now needs a real JS runtime to solve YouTube's signature
    // ("nsig") challenge — without one it only warns ("No supported
    // JavaScript runtime could be found") and silently drops most/all
    // formats, which is what actually produces "Requested format is not
    // available" downstream. Only "deno" is enabled by default, and the
    // container has neither deno nor node — but the base image is
    // oven/bun:1-debian, so `bun` (a supported runtime) is already on PATH
    // for free. See yt-dlp's EJS wiki page.
    "--js-runtimes",
    "bun",
    // The default "web" client is the most fragile against YouTube's ongoing
    // anti-bot changes ("The page needs to be reloaded" is a web-client-only
    // failure mode) — falling back through android/ios avoids most of it,
    // often without even needing cookies. See yt-dlp#16212, #17405.
    "--extractor-args",
    "youtube:player_client=android,ios,web",
    ...getCookieArgs(),
    "-o",
    "-",
    "--quiet",
    "--no-warnings",
    url,
  ]);

  const ffmpeg = spawn("ffmpeg", [
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-vn",
    "-f",
    "mp3",
    "-ab",
    "192k",
    "pipe:1",
  ]);

  ytDlp.stdout.pipe(ffmpeg.stdin);

  let ytDlpStderr = "";
  ytDlp.stderr.on("data", (chunk) => {
    ytDlpStderr += chunk.toString();
    console.error(`[yt-dlp ${videoId}]`, chunk.toString());
  });
  ffmpeg.stderr.on("data", (chunk) => {
    console.error(`[ffmpeg ${videoId}]`, chunk.toString());
  });
  ytDlp.on("close", (code) => {
    if (code !== 0) ffmpeg.stdin.end();
  });

  // Neither child process gets killed on its own — the client disconnecting
  // (track switch), the safety timeout firing, or one of the two processes
  // failing all used to leave the other one running to completion, which
  // OOMs a free-tier container after a handful of track switches.
  let killed = false;
  const killAll = () => {
    if (killed) return;
    killed = true;
    ytDlp.kill("SIGKILL");
    ffmpeg.kill("SIGKILL");
    releaseSlot();
  };

  if (signal) {
    if (signal.aborted) {
      killAll();
      throw new Error("요청이 취소되었습니다.");
    }
    signal.addEventListener("abort", killAll, { once: true });
  }

  // Once ffmpeg exits (success or failure), yt-dlp has no reason to keep
  // running even if it's still mid-download — and the concurrency slot is
  // free either way.
  ffmpeg.once("close", killAll);

  // A fixed timeout can't tell success from "still working" — yt-dlp's own
  // failures can take anywhere from milliseconds to several seconds (it
  // retries across the player_client list above before giving up). So
  // instead: race real evidence of success (ffmpeg actually produced audio
  // bytes) against real evidence of failure (yt-dlp exited non-zero), with a
  // generous timeout only as a backstop against a genuine hang — never as
  // the thing that decides success. This is what lets /api/extract return a
  // real error instead of a 200 with an empty/broken body.
  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(safetyTimer);
      ffmpeg.stdout.off("readable", onReadable);
      ytDlp.off("error", onYtDlpSpawnError);
      ytDlp.off("close", onYtDlpClose);
      ffmpeg.off("error", onFfmpegSpawnError);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      killAll();
      reject(err);
    };

    const onReadable = () => {
      const chunk = ffmpeg.stdout.read();
      if (chunk) {
        ffmpeg.stdout.unshift(chunk); // peek without consuming — Readable.toWeb sees it again below
        succeed();
      }
    };
    const onYtDlpSpawnError = (err: Error) => fail(new Error(`yt-dlp을(를) 실행할 수 없습니다: ${err.message}`));
    const onYtDlpClose = (code: number | null) => {
      if (code !== 0) fail(new Error(summarizeYtDlpError(ytDlpStderr)));
    };
    const onFfmpegSpawnError = (err: Error) => fail(new Error(`ffmpeg 실행 실패: ${err.message}`));
    const safetyTimer = setTimeout(() => fail(new Error("추출 시간이 초과되었습니다.")), 45_000);

    ffmpeg.stdout.on("readable", onReadable);
    ytDlp.once("error", onYtDlpSpawnError);
    ytDlp.once("close", onYtDlpClose);
    ffmpeg.once("error", onFfmpegSpawnError);
  });

  // Tee ffmpeg's output: one copy streams to the client as before, the other
  // is written to the server-side tmp cache (see lib/audio-cache.ts) so a
  // second request for the same videoId — from a page reload, or from the
  // client's own background IndexedDB-caching fetch (see resolve-audio.ts) —
  // reads a file instead of re-running yt-dlp+ffmpeg.
  const clientStream = new PassThrough();
  const cacheWritePath = getCacheWritePath(videoId);
  const cacheWriteStream = createWriteStream(cacheWritePath);

  let ffmpegExitCode: number | null = null;
  let cacheWriteSettled = false;
  const finalizeCache = () => {
    if (ffmpegExitCode === null || !cacheWriteSettled) return;
    if (ffmpegExitCode === 0) commitCacheWrite(videoId);
    else discardCacheWrite(videoId);
  };
  ffmpeg.once("close", (code) => {
    ffmpegExitCode = code ?? -1;
    finalizeCache();
  });
  cacheWriteStream.once("finish", () => {
    cacheWriteSettled = true;
    finalizeCache();
  });
  cacheWriteStream.once("error", (err) => {
    console.warn(`audio cache write failed for ${videoId}: ${err.message}`);
    cacheWriteSettled = true;
    discardCacheWrite(videoId);
  });

  ffmpeg.stdout.on("data", (chunk) => {
    clientStream.write(chunk);
    if (!cacheWriteStream.destroyed) cacheWriteStream.write(chunk);
  });
  ffmpeg.stdout.on("end", () => {
    clientStream.end();
    if (!cacheWriteStream.destroyed) cacheWriteStream.end();
  });
  ffmpeg.stdout.on("error", (err) => {
    clientStream.destroy(err);
    cacheWriteStream.destroy();
  });

  return { stream: Readable.toWeb(clientStream) as ReadableStream<Uint8Array>, abort: killAll };
}
