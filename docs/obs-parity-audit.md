# OBS parity and friction audit (2026-10-08)

## Status after implementation (2026-10-08)
- **Built, phases 1–3:**
  - Audio: cleanup switch, filters, monitoring and headphones device, sync offset, mono, device pickers, dB readout, stereo meters, per-source tracks.
  - Hotkeys, including push-to-talk.
  - Instant replay; custom and "same as stream" recording bitrate; auto-record.
  - Video effects; scene reorder/duplicate; source duplicate; copy/paste of transform and effects; nudge; Alt-crop.
  - First-run setup; platform bitrate hints; destination Advanced options (audio bitrate, keyframe interval, encoder speed); stream delay and reconnect; stats panel; confirm before ending a stream.
  - Studio Mode, projectors, multiview; stinger and shuffle transitions; per-scene transition overrides; virtual camera.
  - Scene collections and profiles; OBS/Streamlabs import; fractional FPS, colour format/space/range, sample rate and channels, multi-track recording.
- **Not possible with the bundled engine (obs-studio-node 0.26.29b21):**
  - Recording pause and program screenshot (no API).
  - Audio balance (no binding).
  - Move transition (not installed).
  - T-bar (no manual transition control).
  - P010/HDR (no format; outputs are H.264).
  - Virtual camera on macOS: needs a signed camera system extension that the bundled engine cannot install. It is shown as unavailable unless the extension is already present.
- **Verified headless:**
  - Typecheck and lint pass; `bun test src` passes 267 tests.
  - The `check:sources`, `check:responsiveness`, `check:audio`, `check:transitions`, `check:remove-source`, `check:presets` and `check:multistream` scripts pass.
  - The macOS preview harness passes, including Studio Mode and projector displays.
- **Live checks still pending:** see the agents' notes on filters persisting after a restart, monitoring audio, stinger playback, replay saving, push-to-talk, collection switching, OBS import with real files, and Windows hardware.

Compared SEENALYZE STUDIO against OBS Studio 31/32, using the official KB screenshots of all seven OBS Settings tabs plus the KB and release notes, and against Streamlabs Desktop, Meld Studio, XSplit, PRISM, StreamYard, Restream and Ecamm Live. Twitch Studio was discontinued in May 2024 and is used only as a historical reference.

Legend: ✅ have it · 🟡 partial · ❌ missing. Priority P1 = core and frequently used, P2 = valuable, P3 = power-user.

## Settings, tab by tab (OBS → us)

| OBS setting | Us | Priority | Lower-friction version |
|---|---|---|---|
| General: confirm start/stop stream | 🟡 start only | P2 | Confirm stop only when it would end a long stream |
| General: auto-record when streaming | ❌ | P1 | "Also record when I go live" switch |
| General: keep recording / replay buffer when stream stops | ❌ | P2 | Part of the same switch |
| General: snapping (on/off, sensitivity, edges/sources/centre) | 🟡 always on, Alt disables | P3 | One "Snap while moving" switch |
| General: projector options, tray | ❌ | P3 | — |
| Stream: service / server / key / get key | ✅ (destinations, OAuth or key) | — | Already better: one-click accounts and multistream |
| Output: video bitrate | ✅ per destination | — | Show platform range next to the input (Twitch 3–6k, YouTube up to 51k) |
| Output: audio bitrate | ❌ (fixed 160, profile field without UI) | P2 | Advanced disclosure in the destination dialog |
| Output: encoder | ✅ Settings › Video | — | Show a "Hardware (recommended)" badge |
| Output: rate control, preset, profile, keyframe, B-frames | ❌ (CBR/high/2 s fixed) | P2 | "Quality ↔ Performance" preset slider; raw options behind Advanced |
| Output: recording path / format | ✅ | — | — |
| Output: recording quality | 🟡 4 presets, no custom value | P1 | Add a "Custom" bitrate field, or "Same as stream" |
| Output: recording encoder separate from stream | ❌ | P3 | — |
| Output: audio tracks (1–6) | ❌ | P3 | — |
| Output: replay buffer (length, memory) | ❌ | P1 | "Instant replay: keep last N s" + Save clip button and hotkey |
| Output: automatic file splitting | ❌ | P3 | — |
| Audio: sample rate, channels | ❌ (fixed) | P3 | — |
| Audio: global desktop / mic devices | 🟡 via source properties only | P1 | Device pickers directly in the mixer row |
| Audio: meter decay / peak type | ❌ | P3 | — |
| Audio: monitoring device | ❌ | P1 | Headphone picker next to per-source monitoring |
| Audio: push-to-talk / push-to-mute | ❌ | P2 | Part of Hotkeys |
| Video: base / output resolution, downscale filter, FPS | ✅ | — | Already simpler |
| Video: fractional FPS (29.97…) | ❌ | P3 | — |
| Hotkeys | ❌ entirely | P1 | Short list of actions with "press keys" capture, no 200-row wall |
| Advanced: colour format / space / range | ❌ (NV12/709/partial fixed) | P3 | Keep fixed; expose under Advanced only |
| Advanced: filename format, auto-remux | ❌ | P3 | MKV → MP4 auto-remux switch (P2) |
| Advanced: stream delay | ❌ (engine supports it, off) | P2 | "Delay my stream by N s" |
| Advanced: auto-reconnect retry / attempts | 🟡 fixed 2 s × 25 | P3 | Keep defaults |
| Advanced: network bind IP, process priority | ❌ | P3 | — |
| Accessibility (colour overrides) | ❌ | P3 | — |

## Features outside settings

| OBS feature | Us | Priority |
|---|---|---|
| Audio filters: noise suppression, noise gate, gain, compressor, limiter, expander | ❌ | **P1**: "Clean up my mic" one switch, with advanced filters behind it |
| Video filters: colour correction, chroma / colour key, crop/pad, LUT, sharpen, scroll, mask, render delay | ❌ | **P1**: per-source "Effects" with chroma key and colour first |
| Advanced audio properties: monitoring, sync offset, balance, mono, tracks | ❌ | **P1** monitoring + sync offset; P2 balance, mono |
| Mixer dB readout, stereo meters | 🟡 | P2 |
| Studio Mode (preview / program, T-bar, quick transitions) | ❌ | P2 |
| Transitions: stinger, move, per-scene overrides | 🟡 18 presets, no stinger or overrides | P2 |
| Replay buffer | ❌ | P1 |
| Recording pause / resume | ❌ | P1 |
| Virtual camera | ❌ | P2 (macOS needs a system extension) |
| Screenshot of program | ❌ | P2 |
| Scene reorder / duplicate, source duplicate, copy/paste transform, groups | ❌ | P2 |
| Arrow-key nudge, Alt-drag crop, multi-select | ❌ | P2 |
| Stats dock (memory, disk, dropped %, render time) | 🟡 header only | P2 |
| Profiles, multiple scene collections, OBS / Streamlabs import | ❌ | P3 (import is a strong onboarding win: P2) |
| Projectors, multiview | ❌ | P3 |
| Auto-config wizard | ❌ | **P1** |
| WebSocket, scripting, plugins | ❌ | P3 |
| Remux recordings | ❌ | P3 |

## Things we already do better than OBS
- One-click YouTube/Twitch accounts, multistream with shared encoders, per-destination live control and statistics.
- Merged chat, title and category editing, 20 overlay presets and the AI overlay designer.
- Pre-flight stream check, permission explainers, settings locked while live.
- A built-in screen recorder with editor (zooms, captions, camera).

## Low-friction patterns to adopt (ranked, from the competitor research)
1. First-run guided setup: detect the encoder, pick the canvas from the screen, suggest bitrate per platform, ask the mode (stream / record / screen recording), and import OBS scenes if found.
2. Encoder auto-detect with a visible "Hardware" badge.
3. Quality presets instead of raw encoder flags; Advanced stays hidden by default.
4. Pre-live checklist (we have the core; add a mic-level check and a destination-connected check).
5. Platform bitrate ranges inline, warning when out of range.
6. Permission explainers with exact System Settings paths (we have them).
7. Settings locked while live with a clear reason (we have it).
8. Starter scene layouts (talking head, gameplay, screen + camera).
9. Wi-Fi warning.
10. Scheduling kept separate from going live (YouTube).

## Proposed delivery phases
- **Phase 1 (core gaps):**
  - Audio filters ("Clean up my mic" plus advanced).
  - Video effects (chroma key, colour correction, crop, LUT).
  - Audio monitoring and sync offset.
  - Global audio device pickers.
  - Hotkeys.
  - Replay buffer with Save clip.
  - Recording pause and custom recording bitrate.
  - Auto-record when live.
- **Phase 2 (friction and polish):**
  - First-run setup wizard and OBS scene import.
  - Encoder quality preset, audio bitrate and stream delay under Advanced.
  - Platform bitrate hints.
  - Studio Mode, stinger transitions, scene reorder and duplicate, source duplicate, nudge and crop.
  - Stats panel and screenshot.
- **Phase 3 (power user):**
  - Virtual camera, projectors and multiview.
  - Profiles and collections.
  - Colour space, fractional FPS, audio tracks, remux, accessibility colours.
