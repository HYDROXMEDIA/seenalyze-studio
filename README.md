# SEENALYZE STUDIO

A desktop live-streaming studio for macOS and Windows. Build scenes from your screen, windows, camera, microphone, images, video, text and web pages, then go live on YouTube and Twitch at the same time — straight from your computer, with no relay service in between.

## Highlights
- Native multistreaming: destinations with the same video settings share a single hardware encode, while each keeps its own connection and automatic reconnect.
- Live preview, scenes, sources with properties, audio mixer with meters, local recording.
- YouTube and Twitch account sign-in, or a plain stream key.

## Development
```bash
bun install      # installs dependencies and downloads the verified engine binaries
bun run dev
```
Account sign-in needs public OAuth client IDs: copy `config/studio.config.example.json` to `config/studio.config.json` and fill it in. Without it, destinations work with a stream key.

## License
GPL-2.0-or-later. This application uses libobs (OBS Studio) through obs-studio-node. It is not affiliated with or endorsed by the OBS Project. See `LICENSE`.
