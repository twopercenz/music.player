# music.player Companion (browser extension)

Resolves YouTube audio for [../lib/resolve-audio.ts](../lib/resolve-audio.ts) from inside your
own browser instead of a server. See the top-of-file comments in
[background.js](background.js) and [content-script.js](content-script.js) for how, and the
repo root [README.md](../README.md#invidious-companion이란) for why this exists (YouTube blocks
PO token validation from every cloud IP we tried — this sidesteps that entirely by using your
actual residential IP, since it's just your browser visiting a real youtube.com page).

## Install (unpacked — no Chrome Web Store account needed)

Chromium-based browsers only (Chrome, Edge, Brave, ...) — `chrome.runtime` isn't available
elsewhere, and `lib/extension-bridge.ts` falls back to the server-side `/api/extract` path if
it's not detected.

1. `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → select this `extension/` folder.
3. It should load with the ID `kkbbdkllfhgoidgpjfgehjponjlkelli` (fixed — see
   `manifest.json`'s `"key"`, [lib/constants.ts](../lib/constants.ts)'s `EXTENSION_ID` comment).
   If the ID is different, `lib/extension-bridge.ts` is talking to the wrong extension and every
   resolve will silently fail as "not available" — reload and confirm the ID matches.
4. Open the app (`http://localhost:3000` in dev, or your Vercel URL) and play a track. No
   extension UI, no popup — it just works quietly in the background, or falls back to
   `/api/extract` if something goes wrong.

## Debugging

- `chrome://extensions` → this extension → **service worker** link → opens its console
  (background.js logs/errors, and any uncaught exception in `resolveVideo`).
- While a track is loading, a hidden `youtube.com/watch?v=...` tab appears briefly in
  `chrome://extensions` → this extension → **background page** isn't a thing in MV3, but you
  can watch it in the actual tab strip for a moment (it's created `active: false`, so it won't
  steal focus, but it does briefly exist — `chrome://inspect/#pages` can attach to it if you
  need to see console output from `content-script.js` mid-run).
- Common failure: `ytInitialPlayerResponse를 찾지 못했습니다` — YouTube changed the page's
  script structure; the regex in `content-script.js`'s `readPlayerResponse()` needs updating.
- Common failure: format has no `.url` (needs signature deciphering) — this extension doesn't
  implement that (Invidious Companion's `youtubePlayerHandling.ts` does); falls back to
  `/api/extract` automatically.

## Packaging for real (optional, not needed for personal use)

`extension-key.pem` (gitignored, `*.pem`) is the private half of the keypair `manifest.json`'s
`"key"` field was derived from. Keep it if you ever want to package a signed `.crx` or publish
to the Chrome Web Store with the same stable ID — otherwise it's dead weight, delete it.
