// Service worker. Handles resolve requests from the web app (see
// externally_connectable in manifest.json) by opening a real
// youtube.com/watch tab — using the browser's own residential IP and
// session, same as if the user navigated there by hand — and asking
// content-script.js to pull the playback URL out of it.
//
// This replaces the whole server-side extraction path (Invidious Companion)
// for anyone with this extension installed: no server ever talks to
// YouTube, so there's no cloud IP for Google's bot detection to block.
// See lib/resolve-audio.ts on the web app side.

const VIDEO_ID_RE = /^[\w-]{11}$/;
const TAB_LOAD_TIMEOUT_MS = 15000;
const EXTRACT_TIMEOUT_MS = 8000;

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => (...args) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      fn(...args);
    };
    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") succeed();
    };
    const succeed = done(resolve);
    const fail = done(reject);
    const timer = setTimeout(() => fail(new Error("페이지 로드가 너무 오래 걸립니다.")), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function askContentScript(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("확장 프로그램이 페이지에서 응답하지 않습니다.")),
      timeoutMs,
    );
    chrome.tabs.sendMessage(tabId, { type: "extract" }, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function resolveVideo(videoId) {
  if (!VIDEO_ID_RE.test(videoId)) {
    return { ok: false, error: "invalid videoId" };
  }

  let tab;
  try {
    tab = await chrome.tabs.create({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      active: false,
    });
    await waitForTabComplete(tab.id, TAB_LOAD_TIMEOUT_MS);
    const result = await askContentScript(tab.id, EXTRACT_TIMEOUT_MS);
    return result ?? { ok: false, error: "빈 응답을 받았습니다." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (message?.type === "resolve" && typeof message.videoId === "string") {
    resolveVideo(message.videoId).then(sendResponse);
    return true; // async response
  }
  return false;
});
