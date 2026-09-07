import "server-only";

/**
 * Resolves a playable audio stream for a YouTube video via a self-hosted
 * Invidious Companion instance (see docker-compose.yml) instead of shelling
 * out to yt-dlp + ffmpeg (see git history for the old lib/extract.ts).
 * Companion does its own PO-token-backed signature deciphering — the thing
 * that actually fixes YouTube's "Sign in to confirm you're not a bot" wall on
 * datacenter IPs, which yt-dlp cookies only ever worked around — and, since
 * every request below passes `local=true`, proxies the resulting
 * videoplayback bytes through itself rather than handing back a raw
 * googlevideo.com URL, so the stream isn't IP-locked to whichever machine
 * happens to fetch it. See its videoPlaybackProxy.ts and the wiki:
 * https://github.com/iv-org/invidious-companion/wiki
 */

const COMPANION_URL = (process.env.COMPANION_URL ?? "http://invidious_companion:8282").replace(
  /\/+$/,
  "",
);

export class CompanionError extends Error {}

interface CompanionFormat {
  itag: number;
  mimeType: string;
  bitrate?: number;
}

interface CompanionPlayerResponse {
  playabilityStatus?: { status: string; reason?: string };
  streamingData?: {
    adaptiveFormats?: CompanionFormat[];
    formats?: CompanionFormat[];
  };
}

export interface PlayableAudio {
  /** Absolute URL on the Companion service that streams the actual audio bytes (supports Range). */
  url: string;
  mimeType: string;
}

function secretKey(): string {
  const key = process.env.COMPANION_SECRET_KEY;
  if (!key) throw new CompanionError("COMPANION_SECRET_KEY is not set");
  return key;
}

function playabilityErrorMessage(reason: string | undefined): string {
  if (!reason) return "재생에 실패했습니다.";
  // The exact string Companion returns while its PO token minter is still
  // warming up — see its src/constants.ts (TOKEN_MINTER_NOT_READY_MESSAGE).
  if (/potoken|companion is starting/i.test(reason)) {
    return "재생 서버가 아직 준비 중입니다. 잠시 후 다시 시도해주세요.";
  }
  if (/private/i.test(reason)) return "비공개 영상이라 재생할 수 없습니다.";
  if (/unavailable|removed|not exist/i.test(reason)) return "삭제되었거나 재생할 수 없는 영상입니다.";
  if (/country|region/i.test(reason)) return "지역 제한으로 재생할 수 없는 영상입니다.";
  if (/sign in|age/i.test(reason)) return "로그인이 필요한 영상이라 재생할 수 없습니다.";
  return reason;
}

async function fetchPlayerInfo(
  videoId: string,
  signal: AbortSignal | undefined,
): Promise<CompanionPlayerResponse> {
  let res: Response;
  try {
    res = await fetch(`${COMPANION_URL}/companion/youtubei/v1/player`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoId }),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new CompanionError(
      `Invidious Companion에 연결할 수 없습니다: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (!res.ok) {
    throw new CompanionError(`Invidious Companion player 요청 실패 (${res.status})`);
  }
  return res.json();
}

/** Prefers audio/mp4 (AAC) — audio/webm (Opus) doesn't play in Safari. Highest bitrate wins within a family. */
function pickBestAudioFormat(formats: CompanionFormat[]): CompanionFormat | null {
  const audioOnly = formats.filter((f) => f.mimeType?.startsWith("audio/"));
  if (audioOnly.length === 0) return null;

  const familyRank = (f: CompanionFormat) => (f.mimeType.startsWith("audio/mp4") ? 0 : 1);
  return audioOnly.sort((a, b) => {
    const familyDelta = familyRank(a) - familyRank(b);
    return familyDelta !== 0 ? familyDelta : (b.bitrate ?? 0) - (a.bitrate ?? 0);
  })[0];
}

export async function resolvePlayableAudio(
  videoId: string,
  signal?: AbortSignal,
): Promise<PlayableAudio> {
  const player = await fetchPlayerInfo(videoId, signal);
  if (player.playabilityStatus?.status !== "OK") {
    throw new CompanionError(playabilityErrorMessage(player.playabilityStatus?.reason));
  }

  const formats = [
    ...(player.streamingData?.adaptiveFormats ?? []),
    ...(player.streamingData?.formats ?? []),
  ];
  const best = pickBestAudioFormat(formats);
  if (!best) throw new CompanionError("재생 가능한 오디오 트랙을 찾지 못했습니다.");

  const latestVersionUrl = new URL(`${COMPANION_URL}/companion/latest_version`);
  latestVersionUrl.searchParams.set("id", videoId);
  latestVersionUrl.searchParams.set("itag", String(best.itag));
  latestVersionUrl.searchParams.set("local", "true");

  // Companion replies with a redirect to its own /videoplayback proxy
  // (a relative path — resolved against COMPANION_URL below) rather than a
  // page we're meant to actually follow, so capture the Location instead of
  // letting fetch chase it.
  let redirectRes: Response;
  try {
    redirectRes = await fetch(latestVersionUrl, { redirect: "manual", signal, cache: "no-store" });
  } catch (error) {
    throw new CompanionError(
      `Invidious Companion에 연결할 수 없습니다: ${error instanceof Error ? error.message : error}`,
    );
  }
  const location = redirectRes.headers.get("location");
  if (!location) {
    const body = await redirectRes.text().catch(() => "");
    throw new CompanionError(
      body || `Invidious Companion latest_version 요청 실패 (${redirectRes.status})`,
    );
  }

  return { url: new URL(location, COMPANION_URL).toString(), mimeType: best.mimeType };
}
