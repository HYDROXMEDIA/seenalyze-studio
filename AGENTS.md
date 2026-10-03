# SEENALYZE STUDIO desktop — Agent Operating Guide

Inherits `~/Desktop/dev/AGENTS.md` and all system/user rules; this file only adds project detail and never weakens them.

## Purpose and boundaries
Desktop live-streaming studio (Electron, macOS + Windows) with native multistreaming: one encode is shared by every destination with identical video settings, and each destination has its own connection, reconnect loop and statistics. Video goes straight from the user's machine to each platform — never through a relay.
- **This repository is public and GPL-2.0-or-later** because it links libobs. Never add proprietary code, secrets, server credentials or private dashboard source here.
- The private service (accounts, billing, OAuth brokering where a platform requires a client secret) lives in `../backend` — a separate repository. Never import between them.
- Platforms in scope: **YouTube and Twitch only**. Do not add others unless the maintainer asks.

## Layout
- `src/main/` — Electron main process: window, IPC, persisted state, secrets, platform APIs (`platforms/`), and `studio.ts`, which implements the IPC API. It never calls libobs directly.
- `src/main/engine/` — libobs, running in a **separate utility process** (`worker.ts`, driven from main by `client.ts`). `osn.ts` loader, `engine.ts` canvas/encoders/teardown, `scenes.ts`, `audio.ts`, `preview.ts` (engine side of the preview), `outputs.ts` multistream, `orphans.ts` leftover-host cleanup. `src/main/preview-mac.ts` shows the macOS preview surface in the window's own process.
- `src/main/chat/` — read-only live chat: `twitch-chat.ts` (anonymous IRC WebSocket, no token), `youtube-chat.ts` (polls the active broadcast's chat at YouTube's requested interval; every call costs API quota), `hub.ts` merges both and batches events to the renderer. Chat connects only while the chat panel is visible.
- `src/main/overlay/` — local overlay server (127.0.0.1 only, default port 47821, falls back to nearby ports and retargets saved overlay sources) serving the on-stream chat overlay page (`chat-page.ts`, self-contained, text inserted as text nodes only) and its event stream. The "Chat overlay" source is a browser source pointing at it.
- `src/main/permissions.ts` — camera/microphone/screen-recording access. Capture sources must request access before the engine creates them; otherwise capture silently produces black frames or silence.
- `src/preload/` — exposes exactly the `StudioApi` contract on `window.studio`.
- `src/shared/` — IPC contract (`ipc.ts`), domain types, encoder planner, platform specs. No Electron/Node/libobs imports.
- `src/renderer/` — Vite + React 19 + Tailwind 4 + shadcn-style components. Design tokens mirror the SEENALYZE web dashboard; icons in `assets/icons` are copies of dashboard compact PNGs.
- `vendor/` (gitignored) — prebuilt libobs binding (`obs-studio-node`) and macOS preview helper, fetched by `scripts/fetch-native-deps.mjs` from `native-deps.json` with pinned SHA-256 hashes.

## Commands
```bash
bun install                 # also fetches + verifies the engine (postinstall)
bun run dev                 # electron-vite dev
bun run typecheck
bun run lint
bun test src                # planner + translation coverage tests
bun run check:multistream      # shared-encoder multistream check against local RTMP receivers (see script header)
bun run check:responsiveness   # hidden-window check: main thread never blocks, quit is fast, no leftover engine
bun run dist:mac | dist:win
```

## Rules specific to this project
- **One running instance.** Before building or launching, stop previous dev instances, `obs64 seenalyze-studio-*` engine hosts and local test receivers.
- Engine calls are synchronous and can block for seconds (permission prompts, font/device enumeration, teardown). They must only run in the engine worker; the main process talks to it asynchronously with timeouts. The main process may only use the macOS preview helper (`loadNwr`) and types from `engine/`; it must never call `loadOsn()` or any libobs object.
- Teardown rules (verified): never `release()` scenes/sources before engine shutdown; remove a scene's items before releasing the scene; `InitShutdownSequence` → `OBS_API_destroyOBS_API` → `IPC.disconnect` → stop the host process. Renamed sources keep their old name in the engine client, so always map names through `SceneGraph.nameOf`.
- Only `src/main/engine/*` may touch libobs objects. Use the engine's short encoder names (`apple_h264`, `nvenc`, `amd`, `qsv`, `x264`); unknown names silently fall back to x264.
- Shared encoders: never enable per-output dynamic bitrate; a destination needing different video settings gets its own encoder group (`shared/planner.ts`).
- The preview is a native surface above the web UI. Every overlay root in `components/ui/overlays.tsx` hides it while open; new floating UI must use those primitives.
- Stream keys and OAuth tokens: only through `src/main/secrets.ts` (Electron safeStorage). Never log, persist in JSON, or send them to the renderer.
- OAuth client IDs come from `config/studio.config.json` (gitignored; see the example). Never read `.env` files.
- All UI text goes through `use-intl` with keys in `src/renderer/messages/en.json`; main-process errors are kebab-case codes mapped under `errors.codes.*`. `messages.test.ts` enforces coverage.
- To add a Windows engine build, pin its SHA-256 in `native-deps.json` after verifying the archive.

## Verification
Run `bun run typecheck`, `bun run lint`, `bun test src` after changes. For engine/output changes, also run `bun run check:multistream` and `bun run check:responsiveness`. Do not drive the user's screen to verify; use these headless checks. Windows behaviour has not been verified on hardware yet — say so when reporting.
