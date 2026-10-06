# Streaming functionality compared with OBS

Reviewed 2026-10-06. Scope: source setup and direct Twitch/YouTube broadcasting. This is a functionality inventory, not a release certification.

## Source support after this change

The picker reads the installed engine's source registry. Optional sources appear only when their module is available; no unsupported source is advertised as working.

| Source | macOS | Windows | Configuration |
| --- | --- | --- | --- |
| Display / window | Available | Available | Display/window dropdown, cursor and capture options |
| Application video | Modern screen capture module | Use window or game capture | Application dropdown |
| Game capture | Use display/window/application | Game module required | Capture mode and game/window dropdown |
| Camera / capture card | Video device module | Video device module | Connected-device dropdown and exposed video/audio options |
| Microphone / audio input | Available | Available | Input-device dropdown, including virtual audio devices |
| Desktop / audio output | System-audio or output-device module | Output-device module | Capture method or output-device dropdown |
| Application audio | System-audio module | Process-audio module | Application/process selection |
| Image / color / text | Available | Available | File, color, text and font controls |
| Image slideshow | Slideshow module | Slideshow module | Ordered file list and slideshow settings |
| Audio/video file | Available | Available | File and playback settings |
| Media playlist | Playlist module required | Playlist module required | Ordered files/addresses |
| Browser / chat overlay | Browser module | Browser module | Address, dimensions and exposed settings |
| Another scene | Available | Available | Shared scene reference; recursive nesting is rejected |
| Syphon | Module required | Not applicable | Exposed source properties |
| Blackmagic device | Module and device support required | Module and device support required | Exposed device properties |

Existing sources can be reused across scenes without opening another copy of a device. Scene references and their transforms survive save/reload. Device lists come from native properties and can be refreshed after a connection change. The audio mixer opens properties for global audio sources too.

Disconnected or inaccessible saved sources do not prevent startup. Their settings and scene references are retained for the next launch, and the app reports that some sources could not open.

The generic property panel handles lists (including empty placeholder values), numbers, booleans, file paths, fonts and editable file lists. Frame-rate property objects, grouped properties and specialized capture property objects still need dedicated editors. There is no continuous hotplug status or missing-device placeholder in the scene list.

OBS's source availability and platform differences are documented in its [Sources Guide](https://obsproject.com/kb/sources-guide), [macOS Screen Capture guide](https://obsproject.com/kb/macos-screen-capture-source) and [Audio Sources guide](https://obsproject.com/kb/audio-sources).

## Account broadcasting

Twitch sign-in already requests channel access and resolves the signed-in channel's stream key. YouTube sign-in uses the system browser and a loopback callback; a reusable ingest stream is bound to a new broadcast with the selected visibility and automatic start/stop. Keys and account tokens remain in encrypted storage outside the renderer. These paths follow [Twitch's account flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow), its [stream-key API](https://dev.twitch.tv/docs/api/reference#get-stream-key), and [YouTube's broadcast API](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts).

This change rejects invalid account destinations, cancels preparation when the user ends a stream, cleans up a YouTube broadcast whose binding failed, ignores unrelated sign-in callbacks, and releases failed outputs without disrupting destinations that share their encoder.

The checkout has no account sign-in configuration. Populate the existing gitignored configuration from the example locally using registered Twitch and YouTube desktop app settings; do not paste credentials into chat. Twitch needs the public client type used by its device flow. YouTube needs a Desktop app client with the YouTube Data API enabled and the correct consent/test-user setup. See [Google's desktop authorization guide](https://developers.google.com/identity/protocols/oauth2/native-app). A channel must also have live streaming enabled.

## Remaining functionality gaps

| Priority | Gap | User impact |
| --- | --- | --- |
| Next | Preview dragging and resize handles | Exact position, size, rotation, anchoring and crop editing now works; direct manipulation in the preview is still missing |
| Next | Audio filters and advanced audio properties | No noise suppression, gates, compression, monitoring, sync offsets or track-routing UI |
| Next | Preview/program studio mode and transitions | Scene changes go directly to program; no staging or transition controls |
| Next | Global hotkeys | No configured shortcuts for scene switches, mute, start/stop or source actions |
| Later | Source grouping, duplication and collection import/export | Reuse/nested scenes work; source groups and portable scene collections need a UI |
| Later | Media transport and browser interaction | No explicit play/pause/seek controls or interactive browser-source window |
| Later | Replay buffer and virtual camera | Neither is exposed |
| Later | Recording formats, separate audio tracks and Twitch VOD audio | Recording is MKV; advanced recording/audio choices are not exposed |
| Later | Output diagnostics, bandwidth testing and recovery guidance | Basic bitrate/drop statistics exist, but no setup wizard or detailed connection diagnostics |
| Later | Plugin management | Installed modules are discovered; installing third-party source plugins is not a supported workflow |

The audio/effect gaps are compared with OBS's [Filters Guide](https://obsproject.com/kb/filters-guide). The rest of this inventory comes from the Studio IPC contract, engine modules and current controls.

## Verification and required manual checks

### Latest MVP improvements

- Source layouts can be edited with exact coordinates, dimensions, rotation, anchoring, sizing and crop values. Changes are staged until saved, locked items are protected, invalid crops cannot remove the entire picture, and layouts survive restart.
- Going live checks the active scene for missing/unready pictures and unmuted sound, including scene audio and global audio. It also checks destination credentials locally. Warnings allow an intentional silent/audio-only stream; an incomplete destination can be excluded while ready destinations continue.
- Ending one destination uses a confirmation dialog. Shared confirmation titles now use the correct dialog primitive, including nested discard dialogs.
- Account requests have a 30-second deadline, malformed responses cannot overwrite stored tokens, and invalid refresh credentials report that the user needs to reconnect.
- Source icons use the shared vector library. Source and overlay color fields use a custom color plane, vertical hue strip, hex input and opacity control; transparent colors retain their alpha channel.

Stream checks inspect local configuration and source geometry. They do not verify camera permissions on real hardware, inspect rendered pixels, validate a stream key remotely, or prove that the platform's viewer receives the broadcast.

- Unit tests, translation coverage, typecheck and lint.
- Real macOS engine: source properties, shared sources, nested-scene cycle protection, persistence and preservation of unavailable sources.
- Two local RTMP receivers: both receive H.264 video and AAC audio through a shared encoder; ending one leaves the other live.
- Hidden-window responsiveness and clean shutdown; source picker, shared-source selector and font controls rendered in both themes. Saved previews are in `docs/previews/`.
- Synthetic platform responses exercise Twitch sign-in/ingest and YouTube browser callback, ingest, binding, visibility and failed-broadcast cleanup. This does not prove live account authorization or delivery.
- The Windows engine archive's checksum is now pinned. Its engine/binding are verified as Windows x64, and display, window, game, video-device, input/output audio and application-audio modules are present. This verifies installation integrity and archive contents, not runtime capture.
- Apple Silicon is the macOS engine tested here. Intel Mac distribution remains blocked: its configured engine archive could not be retrieved, and its engine/preview archives have no pinned hashes.

Manual validation still required: physical/virtual device selection and unplug/reconnect, screen/window/application capture and audible system sound on macOS and Windows, permission denial/recovery, and a real signed-in Twitch/YouTube broadcast confirmed from each platform's viewer. Check sound is captured once when screen capture also includes audio. Windows has not been verified on hardware here.
