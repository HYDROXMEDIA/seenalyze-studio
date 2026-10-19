# SEENALYZE STUDIO desktop — Agent Operating Guide

Inherits `~/Desktop/dev/AGENTS.md` and all system/user rules; this file only adds project detail and never weakens them.

## Purpose and boundaries
Desktop live-streaming studio (Electron, macOS + Windows) with native multistreaming, plus screen recording with an editor (automatic zooms, redrawn pointer, camera, backgrounds, cuts, captions, export): one encode is shared by every destination with identical video settings, and each destination has its own connection, reconnect loop and statistics. Video goes straight from the user's machine to each platform — never through a relay.
- **This repository is public and GPL-2.0-or-later** because it links libobs. Never add proprietary code, secrets, server credentials or private dashboard source here.
- The private service (accounts, billing, OAuth brokering where a platform requires a client secret) lives in `../backend` — a separate repository. Never import between them.
- Platforms in scope: **YouTube and Twitch only**. Do not add others unless the maintainer asks.

## Layout
- `src/main/` — Electron main process: window, IPC, persisted state, secrets, platform APIs (`platforms/`), and `studio.ts`, which implements the IPC API. It never calls libobs directly.
- `src/main/engine/` — libobs, running in a **separate utility process** (`worker.ts`, driven from main by `client.ts`). `osn.ts` loader, `engine.ts` canvas/encoders/teardown, `scenes.ts`, `audio.ts`, `preview.ts` (engine side of the preview), `outputs.ts` multistream, `orphans.ts` leftover-host cleanup. `src/main/preview-mac.ts` shows the macOS preview surfaces in the window's own process through the preview presenter (`native/preview_presenter.mm`).
- `src/main/chat/` — read-only live chat: `twitch-chat.ts` (anonymous IRC WebSocket, no token), `youtube-chat.ts` (polls the active broadcast's chat at YouTube's requested interval; every call costs API quota), `hub.ts` merges both and batches events to the renderer. Chat connects only while the chat panel is visible.
- `src/main/overlay/` — overlay system. `presets/` (20 built-in designs; shared helpers in `presets/fields.ts`), `library.ts` (user overlays as JSON in app data), `runtime.ts` (the `window.SEENALYZE` API every overlay uses — keep it in sync with the dashboard designer prompt `STUDIO_OVERLAY_RUNTIME_API` in `dashboard_app/src/lib/server/studio-overlay-contract.ts`), `document.ts` (CSP + settings CSS + runtime injection), `design.ts` (validation of AI designs), `data.ts` (chat/events/stats feed; runs only while an overlay is on screen), and `server.ts`: local overlay server (127.0.0.1 only, default port 47821, falls back to nearby ports and retargets saved overlay sources) serving the on-stream chat overlay page (`chat-page.ts`, self-contained, text inserted as text nodes only) and its event stream. The "Chat overlay" source is a browser source pointing at it.
- `src/main/seenalyze/account.ts` — SEENALYZE account sign-in (PKCE via the dashboard, `seenalyze-studio://` app link) and the AI overlay designer call (`/api/studio/overlays/generate`, charges the user's credits server-side; the dashboard owns the model, key and allowlist).
- `src/main/chat/twitch-eventsub.ts` — follows and channel point redemptions (needs the follower/redemption scopes; older sign-ins must reconnect).
- `src/main/permissions.ts` — camera/microphone/screen-recording access. Capture sources must request access before the engine creates them; otherwise capture silently produces black frames or silence. macOS judges access by the *responsible* app (the one that launched the process tree). `bun run dev` therefore starts Electron through `bin/dev-launcher` (`native/dev_launcher.c`, dev-only, not shipped), which disclaims responsibility so the dev `Electron.app` asks for itself; started directly from a terminal/editor, a hardened parent without the camera entitlement makes macOS refuse the camera without a prompt (`permission-camera-no-prompt`) and the app never appears in System Settings.
- `src/main/screen-recording/` — screen recording and the recording editor, separate from the streaming engine. `index.ts` (`ScreenRecorder`, used by `studio.ts`), `capture.ts` (area/window/screen picker, one panel per display), `recording.ts` (native recorder on macOS, built-in browser recorder elsewhere), `interactions.ts` (pointer, clicks, typing timing; never which keys), `facecam.ts` (live camera bubble, recorded as its own track), `controls.ts` (floating pause/stop bar, kept out of the video), `editor.ts` (editor windows, edits saved per recording, export), `media-protocol.ts` (the `recording-media:` scheme serving only registered files, with byte ranges), `speech.ts` + `windows-speech.ts` (local caption recognition: WhisperKit built from source on macOS, checksum-verified whisper.cpp on Windows; started on demand, stopped when idle), `recording-data.ts` (per-recording data in app data, never next to the video). Pages live in `src/renderer/screen-recording/<page>/` as plain browser modules; their text comes from `en.json` → `screenRecording` through `shared/i18n.js` (use-intl core). Preloads are `src/preload/recording-<page>.ts`.
- `native/` — macOS helpers built into `bin/` (gitignored) by `scripts/build-native.mjs`: Swift executables (`screen-recorder`, `video-muxer`, `media-tools`, `window-list`, `audio-inputs`) and the preview presenter `preview_presenter.mm` (a Node-API addon, `bin/preview-presenter.node`, built with clang against the Node-API headers of the Node running the script). The presenter shows each engine display in a Metal layer above the window content and copies only finished frames; Core Animation scales it, so screen and scale changes need no rebuild. PowerShell scripts in `native/` are used as-is on Windows. Every file the app loads from `bin/` must be in the mac `extraResources` filter in `electron-builder.yml`.
- `src/preload/` — exposes exactly the `StudioApi` contract on `window.studio`.
- `src/shared/` — IPC contract (`ipc.ts`), domain types, encoder planner, platform specs. No Electron/Node/libobs imports.
- `src/renderer/` — Vite + React 19 + Tailwind 4 + shadcn-style components. Design tokens mirror the SEENALYZE web dashboard; in-app icons are SVG only (lucide-react glyphs using `currentColor`, inline SVG platform marks in `components/PlatformIcon.tsx`, and the SVG app logo in `assets/icons`); never add PNG/raster UI icons.
- `vendor/` (gitignored) — prebuilt libobs binding (`obs-studio-node`), fetched by `scripts/fetch-native-deps.mjs` from `native-deps.json` with pinned SHA-256 hashes; folders it installed for dependencies no longer listed are removed.

## Commands
```bash
bun install                 # also fetches + verifies the engine (postinstall)
bun run dev                 # scripts/dev.mjs: native helpers + electron-vite dev (macOS: Electron via bin/dev-launcher, see below)
bun run typecheck
bun run lint
bun test src                # planner + translation coverage tests
bun run check:multistream      # shared-encoder multistream check against local RTMP receivers (see script header)
bun run check:responsiveness   # hidden-window check: main thread never blocks, quit is fast, no leftover engine
bun run check:presets          # renders all overlay presets with demo data; fails on script errors
bun run check:screen-recording # hidden-window editor check on a generated video: load, save, export (needs ffmpeg)
bun run build:native           # macOS helpers and the preview presenter into bin/ (dev and build run it; skips up-to-date ones)
bun run dist:mac | dist:win
```

## Rules specific to this project
- **One running instance.** Before building or launching, stop previous dev instances, `obs64 seenalyze-studio-*` engine hosts and local test receivers.
- Engine calls are synchronous and can block for seconds (permission prompts, font/device enumeration, teardown). They must only run in the engine worker; the main process talks to it asynchronously with timeouts. The main process may only use the preview presenter (through `preview-mac.ts`) and types from `engine/`; it must never call `loadOsn()` or any libobs object.
- Teardown rules (verified): never `release()` scenes/sources before engine shutdown; remove a scene's items before releasing the scene; `InitShutdownSequence` → `OBS_API_destroyOBS_API` → `IPC.disconnect` → stop the host process. Renamed sources keep their old name in the engine client, so always map names through `SceneGraph.nameOf`.
- Only `src/main/engine/*` may touch libobs objects. Use the engine's short encoder names (`apple_h264`, `nvenc`, `amd`, `qsv`, `x264`); unknown names silently fall back to x264.
- Shared encoders: never enable per-output dynamic bitrate; a destination needing different video settings gets its own encoder group (`shared/planner.ts`).
- The preview is a native surface above the web UI. Every overlay root in `components/ui/overlays.tsx` hides it while open; new floating UI must use those primitives. On macOS the engine sizes preview surfaces in physical pixels, capped at the canvas width (the engine copies every frame to the CPU).
- Engine crash reports stay on the user's machine. The engine's crash handler re-enables uploads on start and on every crash, and an empty crash server means its vendor's service, so `engine.ts` passes a closed loopback server (`LOCAL_CRASH_SERVER`) and switches uploads off after init. Never pass an empty `crashServerUrl`.
- Stream keys and OAuth tokens: only through `src/main/secrets.ts` (Electron safeStorage). Never log, persist in JSON, or send them to the renderer.
- OAuth client IDs come from `config/studio.config.json` (gitignored; see the example). Never read `.env` files.
- Exception: with explicit maintainer approval for a specific task, blind `.env` operations are allowed (presence-only checks and piping values via stdin into a named target such as `gh secret set`), following "Blind `.env` operations" in `~/Desktop/dev/AGENTS.md` §10. Values must never be shown, logged, or written anywhere.
- All UI text goes through `use-intl` with keys in `src/renderer/messages/en.json`; main-process errors are kebab-case codes mapped under `errors.codes.*`. `messages.test.ts` enforces coverage.
- Overlays are untrusted code (AI-generated). They run only inside the overlay CSP (no external scripts or network except images) and the editor previews them in a sandboxed frame. User content must be inserted as text (`SEENALYZE.renderSegments` / `textContent`); only `SEENALYZE.platformLogo()` output may use `innerHTML`.
- To add a Windows engine build, pin its SHA-256 in `native-deps.json` after verifying the archive.
- Screen recording: only the picker, camera bubble and built-in recorder pages may use camera/microphone/screen in the renderer (`ScreenRecorder.allowsMedia`); the studio UI never does. Editor pages read files only through `recording-media:` URLs handed out by `media-protocol.ts`. Every editor/recorder IPC handler checks that the sender is its own window. Exports go to a temporary file and are renamed into place; a failed export never replaces a file.

## Verification
Run `bun run typecheck`, `bun run lint`, `bun test src` after changes. For engine/output changes, also run `bun run check:multistream` and `bun run check:responsiveness`. For screen-recording changes, run `bun run check:screen-recording`; live capture, camera, system audio and caption model setup need a manual pass because they require device access or large downloads. Do not drive the user's screen to verify; use these headless checks. Windows behaviour has not been verified on hardware yet — say so when reporting.

## No silent errors

No error may fail silently here. Every caught error must be logged (without secrets) and either recovered from, rolled back to the last valid step with a clear user-facing error and retry, or surfaced loudly (visible error, or non-zero exit for scripts). Empty or swallowing `catch` blocks, unhandled rejections, and output-hiding shell tricks are forbidden. Full rule: "No Silent Errors" in `~/Desktop/dev/AGENTS.md` §10a.

## End-of-response summary (all projects)

- End every response with a short, plain-language summary in **bold** that says what happened, so it can be understood at a glance. Example: "**Everything schema-related is synced.**"
- Lead with the outcome. No file names, commands, SQL, or implementation detail; those belong earlier in the response.
- If several things happened, use at most three short bullets. If something is not done, not verified, or needs the user's decision, say so plainly here.
