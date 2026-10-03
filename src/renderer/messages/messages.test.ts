import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import en from "./en.json";

type Tree = { [key: string]: string | Tree };

function has(tree: Tree, dotted: string): boolean {
  let node: string | Tree | undefined = tree;
  for (const part of dotted.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = node[part];
  }
  return typeof node === "string";
}

const RENDERER = path.join(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("en messages", () => {
  test("keys built from runtime values exist", () => {
    const dynamic = [
      ...["display", "window", "camera", "microphone", "desktopAudio", "image", "media", "text", "color", "browser", "chatOverlay"].map((k) => `sources.kinds.${k}`),
      ...["idle", "preparing", "connecting", "live", "reconnecting", "stopping", "error"].map((k) => `destinations.states.${k}`),
      ...["youtube", "twitch"].map((k) => `destinations.platforms.${k}`),
      ...["account", "manual"].map((k) => `destinations.modes.${k}`),
      ...["apple_h264", "nvenc", "amd", "qsv", "x264"].map((k) => `settings.encoders.${k}`),
      ...["dark", "light", "system"].map((k) => `settings.themes.${k}`),
      ...["video", "recording", "accounts", "appearance"].map((k) => `settings.${k}`),
      ...["public", "unlisted", "private"].map((k) => `streamInfo.privacyOptions.${k}`),
      ...["connecting", "connected", "waiting", "offline", "error"].map((k) => `chat.states.${k}`),
      ...["quota", "disabled", "signedOut", "unavailable"].map((k) => `chat.errors.${k}`),
      ...["owner", "moderator", "vip", "member", "subscriber", "verified"].map((k) => `chat.badges.${k}`),
      ...["youtube", "twitch"].map((k) => `chat.platforms.${k}`),
      ...["granted", "denied", "not-determined", "restricted", "unsupported"].map((k) => `permissions.states.${k}`),
      ...["camera", "microphone", "screen"].flatMap((k) => ["label", "title", "description"].map((f) => `permissions.${k}.${f}`)),
      ...["camera", "microphone", "screen"].map((k) => `errors.codes.permission-${k}-denied`),
      "settings.permissions",
    ];
    const missing = dynamic.filter((key) => !has(en as Tree, key));
    expect(missing).toEqual([]);
  });

  test("every error code thrown by the main process has a message", () => {
    const mainDir = path.join(RENDERER, "..", "main");
    const codes = new Set<string>();
    for (const file of sourceFiles(mainDir)) {
      for (const match of readFileSync(file, "utf8").matchAll(/new Error\("([a-z0-9]+(?:-[a-z0-9]+)+)"\)/gu)) codes.add(match[1]);
    }
    const missing = [...codes].filter((code) => !has(en as Tree, `errors.codes.${code}`));
    expect(missing).toEqual([]);
  });

  test("static t() lookups resolve against their namespace", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(RENDERER)) {
      const source = readFileSync(file, "utf8");
      const namespaces = new Map<string, string>();
      for (const match of source.matchAll(/const (\w+) = useTranslations\(("([^"]*)")?\)/gu)) namespaces.set(match[1], match[3] ?? "");
      for (const [name, namespace] of namespaces) {
        for (const match of source.matchAll(new RegExp(`\\b${name}\\("([^"]+)"`, "gu"))) {
          const key = namespace ? `${namespace}.${match[1]}` : match[1];
          if (!has(en as Tree, key)) missing.push(`${path.basename(file)}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
