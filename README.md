# SEENALYZE STUDIO

A desktop live-streaming studio for macOS and Windows. Build scenes from your screen, windows, camera, microphone, images, video, text and web pages, then go live on YouTube and Twitch at the same time — straight from your computer, with no relay service in between.

## Highlights
- Native multistreaming: destinations with the same video settings share a single hardware encode, while each keeps its own connection and automatic reconnect.
- Live preview, scenes, sources with properties, audio mixer with meters, local recording.
- Exact source placement, sizing, rotation and crop controls, with checks for missing picture/sound and incomplete destinations before going live.
- Screen recording with an editor: record a window, an area or a whole screen with your microphone, system sound and camera, then add automatic zooms, a smooth pointer, backgrounds, cuts, speed changes and captions made on your computer, and export a new video.
- YouTube and Twitch account sign-in, or a plain stream key.
- Source choices follow the installed capture capabilities, with reusable sources and nested scenes, capture cards, application audio, slideshows and optional media/device sources.

## Development
```bash
bun install      # installs dependencies and downloads the verified engine binaries
bun run dev      # on macOS this also builds the screen-recording helpers (Apple Command Line Tools)
```
Account sign-in needs public OAuth client IDs: copy `config/studio.config.example.json` to `config/studio.config.json` and fill it in. Without it, destinations work with a stream key.

See [streaming functionality and remaining OBS gaps](docs/streaming-parity.md) for source coverage, account setup requirements and verification limits. Native source and synthetic account checks run with `bun run check:sources` and `bun run check:platforms`.

## Installers
`bun run dist:mac` and `bun run dist:win` build the macOS disk image and the Windows installer. The Windows installer is one compact window (welcome, optional Options with install location and shortcuts, installing, done) drawn by `build/installer.nsh`, in the same layout as Seenalyze Input and Clipper. Its picture `build/installer/hero.bmp` and the disk image background are rendered from `build/source/` by `scripts/render-installer-art.sh` (needs `rsvg-convert` and ImageMagick). It always installs for the current user, so it never asks for administrator rights. Its text is translated for every language in `nsis.installerLanguages`; `src/main/installer-script.test.ts` checks each string exists. Open the installer on a real Windows machine before releasing it.

## License
GPL-2.0-or-later. This application uses libobs (OBS Studio) through obs-studio-node. It is not affiliated with or endorsed by the OBS Project. See `LICENSE`.
