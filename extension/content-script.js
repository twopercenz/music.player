// Runs (isolated world) on any youtube.com/watch page — including the
// hidden tab background.js opens for a resolve request. Passive: it does
// nothing until asked, so it doesn't interfere with normal YouTube browsing.
//
// It never touches window.ytInitialPlayerResponse directly — Manifest V3
// isolated-world content scripts don't share JS globals with the page's own
// script context (only the DOM). Instead it reads the <script> tag's raw
// text and regex/JSON-parses it, which works from the isolated world since
// that's a DOM read, not a variable read.

/** Mirrors lib/companion.ts's pickBestAudioFormat: prefer audio/mp4 (AAC) —
 * audio/webm (Opus) doesn't play in Safari — then highest bitrate. */
function pickBestAudioFormat(formats) {
  const audioOnly = formats.filter((f) => f.mimeType && f.mimeType.startsWith("audio/"));
  if (audioOnly.length === 0) return null;
  const familyRank = (f) => (f.mimeType.startsWith("audio/mp4") ? 0 : 1);
  return audioOnly.sort((a, b) => {
    const d = familyRank(a) - familyRank(b);
    return d !== 0 ? d : (b.bitrate ?? 0) - (a.bitrate ?? 0);
  })[0];
}

function playabilityErrorMessage(reason) {
  if (!reason) return "재생에 실패했습니다.";
  if (/private/i.test(reason)) return "비공개 영상이라 재생할 수 없습니다.";
  if (/unavailable|removed|not exist/i.test(reason)) return "삭제되었거나 재생할 수 없는 영상입니다.";
  if (/country|region/i.test(reason)) return "지역 제한으로 재생할 수 없는 영상입니다.";
  if (/sign in|age/i.test(reason)) return "로그인이 필요한 영상이라 재생할 수 없습니다.";
  return reason;
}

function readPlayerResponse() {
  const scripts = document.getElementsByTagName("script");
  for (const script of scripts) {
    const text = script.textContent || "";
    const match = text.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // keep scanning — unlikely, but don't let one bad match kill it
      }
    }
  }
  return null;
}

function extract() {
  const player = readPlayerResponse();
  if (!player) {
    return { ok: false, error: "ytInitialPlayerResponse를 찾지 못했습니다 (페이지 구조가 바뀌었을 수 있음)." };
  }
  if (player.playabilityStatus?.status !== "OK") {
    return { ok: false, error: playabilityErrorMessage(player.playabilityStatus?.reason) };
  }
  const formats = [
    ...(player.streamingData?.adaptiveFormats ?? []),
    ...(player.streamingData?.formats ?? []),
  ];
  const best = pickBestAudioFormat(formats);
  if (!best || !best.url) {
    // Formats with no direct `url` need signature deciphering (the part
    // Invidious Companion's youtubePlayerHandling.ts does) — plain
    // ytInitialPlayerResponse parsing can't cover that case.
    return {
      ok: false,
      error: "재생 가능한 오디오 트랙을 찾지 못했습니다 (서명된 URL이 필요한 포맷일 수 있음).",
    };
  }
  return { ok: true, url: best.url, mimeType: best.mimeType };
}

// background.js messages this tab once it's finished loading. Retry briefly
// in case the script tag genuinely isn't in the DOM yet.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "extract") return undefined;

  let attempts = 0;
  const tryExtract = () => {
    const result = extract();
    if (result.ok || attempts >= 15) {
      sendResponse(result);
      return;
    }
    attempts += 1;
    setTimeout(tryExtract, 200);
  };
  tryExtract();
  return true; // async response
});
