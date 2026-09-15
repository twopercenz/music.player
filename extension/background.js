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

function sendToTabOnce(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "extract" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

const CONTENT_SCRIPT_RETRY_DELAY_MS = 200;

// The tab reaching "complete" only means the network load finished — on a
// heavy page like YouTube's watch page, especially in a backgrounded
// (active: false) tab on slower hardware, content-script.js's own
// onMessage listener can still not be registered yet by the time we ask.
// That's a hard, synchronous "no listener" failure from chrome.tabs
// .sendMessage — not something content-script.js's *internal* retry loop
// (which only runs once a message actually reaches it) can ever catch.
// Retry the send itself until the deadline instead of giving up on the
// first "Could not establish connection."
async function askContentScript(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await sendToTabOnce(tabId);
    } catch (error) {
      lastError = error;
      if (!/Could not establish connection/.test(error.message)) throw error;
      console.log("[music.player Companion] content script not ready yet, retrying:", error.message);
      await new Promise((r) => setTimeout(r, CONTENT_SCRIPT_RETRY_DELAY_MS));
    }
  }
  throw lastError ?? new Error("확장 프로그램이 페이지에서 응답하지 않습니다.");
}

async function resolveVideo(videoId) {
  if (!VIDEO_ID_RE.test(videoId)) {
    console.warn("[music.player Companion] rejected invalid videoId", videoId);
    return { ok: false, error: "invalid videoId" };
  }

  let tab;
  try {
    tab = await chrome.tabs.create({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      active: false,
    });
    console.log("[music.player Companion] opened tab", tab.id, "for", videoId);
    await waitForTabComplete(tab.id, TAB_LOAD_TIMEOUT_MS);
    // "complete" doesn't tell us the tab is still on the /watch URL we
    // opened — a consent/age/sign-in interstitial redirect would also fire
    // "complete", just on a page content_scripts.matches doesn't cover, and
    // that's indistinguishable from a content-script bug without this.
    const finalTab = await chrome.tabs.get(tab.id).catch(() => null);
    console.log("[music.player Companion] tab finished loading, final URL:", finalTab?.url);
    const result = await askContentScript(tab.id, EXTRACT_TIMEOUT_MS);
    return result ?? { ok: false, error: "빈 응답을 받았습니다." };
  } catch (error) {
    console.error("[music.player Companion] resolveVideo failed", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // Nothing here logged before — made it impossible to tell "message never
  // arrived (externally_connectable mismatch, extension not active, etc.)"
  // apart from "arrived and failed downstream" from the service worker
  // console alone. Log first, unconditionally, before any other logic.
  console.log("[music.player Companion] onMessageExternal", {
    from: sender?.origin ?? sender?.url,
    type: message?.type,
  });

  if (message?.type === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (message?.type === "resolve" && typeof message.videoId === "string") {
    resolveVideo(message.videoId)
      .then((result) => {
        console.log("[music.player Companion] resolve result", result);
        sendResponse(result);
      })
      .catch((error) => {
        console.error("[music.player Companion] resolve threw", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true; // async response
  }
  console.warn("[music.player Companion] unrecognized message, ignoring", message);
  return false;
});
