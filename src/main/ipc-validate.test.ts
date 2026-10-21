import { describe, expect, test } from "bun:test";
import {
  isBrowserSourceUrl,
  requireBroadcastInfo,
  requireDeflection,
  requireDestinationDraft,
  requireExternalUrl,
  requireIdList,
  requireItemId,
  requireName,
  requireSourceKind,
  requireSourceSettings,
} from "./ipc-validate";

const fails = (run: () => unknown, code = "invalid-request") => expect(run).toThrow(code);

describe("ipc argument validation", () => {
  test("names must be bounded non-empty strings", () => {
    expect(requireName("Scene 1")).toBe("Scene 1");
    for (const bad of ["", 42, null, undefined, {}, "a".repeat(513), "a\u0000b"]) fails(() => requireName(bad));
  });

  test("item IDs are non-negative integers", () => {
    expect(requireItemId(0)).toBe(0);
    for (const bad of [-1, 1.5, Number.NaN, Infinity, "3", null]) fails(() => requireItemId(bad));
  });

  test("source kinds come from the known list", () => {
    expect(requireSourceKind("browser")).toBe("browser");
    for (const bad of ["ffmpeg_source", "", 1, "__proto__"]) fails(() => requireSourceKind(bad));
  });

  test("volume stays between 0 and 1", () => {
    expect(requireDeflection(0.5)).toBe(0.5);
    for (const bad of [-0.1, 1.1, Number.NaN, "1"]) fails(() => requireDeflection(bad));
  });

  test("destination ID lists are bounded and de-duplicated", () => {
    expect(requireIdList(["a", "a", "b"])).toEqual(["a", "b"]);
    fails(() => requireIdList("a"));
    fails(() => requireIdList([1]));
    fails(() => requireIdList(Array.from({ length: 65 }, (_, i) => `d${i}`)));
  });

  test("browser source URLs allow http(s) only", () => {
    expect(isBrowserSourceUrl("https://example.com/page")).toBe(true);
    expect(isBrowserSourceUrl("http://127.0.0.1:47821/overlay/chat")).toBe(true);
    expect(isBrowserSourceUrl("about:blank")).toBe(true);
    expect(isBrowserSourceUrl("about:config")).toBe(false);
    expect(isBrowserSourceUrl("")).toBe(true);
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "chrome://gpu", "not a url", "https://user:pw@example.com", 5]) {
      expect(isBrowserSourceUrl(bad)).toBe(false);
    }
  });

  test("source settings are plain bounded objects with a safe url", () => {
    expect(requireSourceSettings({ url: "https://example.com", width: 800 })).toEqual({ url: "https://example.com", width: 800 });
    fails(() => requireSourceSettings({ url: "file:///tmp/x.html" }), "invalid-url");
    for (const bad of [null, [], "x", { width: Number.POSITIVE_INFINITY }]) fails(() => requireSourceSettings(bad));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    fails(() => requireSourceSettings(cyclic));
  });

  test("destination drafts need valid enums and strings", () => {
    const good = { platform: "twitch", mode: "manual", name: "Main", enabled: true, server: "rtmp://live.example/app", profile: {} };
    expect(requireDestinationDraft(good).platform).toBe("twitch");
    fails(() => requireDestinationDraft({ ...good, platform: "kick" }), "invalid-platform");
    fails(() => requireDestinationDraft({ ...good, mode: "relay" }));
    fails(() => requireDestinationDraft({ ...good, name: 5 }));
    fails(() => requireDestinationDraft({ ...good, enabled: "yes" }));
    fails(() => requireDestinationDraft({ ...good, server: null }), "invalid-server");
    fails(() => requireDestinationDraft({ ...good, profile: null }));
    fails(() => requireDestinationDraft(null));
  });

  test("broadcast info keeps known fields only", () => {
    expect(requireBroadcastInfo({ title: "Hi", privacy: "unlisted", categoryId: null, extra: 1 })).toEqual({
      title: "Hi",
      categoryId: undefined,
      categoryName: undefined,
      privacy: "unlisted",
      youtubeBroadcastId: undefined,
    });
    fails(() => requireBroadcastInfo({ title: 1 }));
    fails(() => requireBroadcastInfo({ title: "x", privacy: "secret" }));
  });

  test("external links must be https", () => {
    expect(requireExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    for (const bad of ["http://example.com", "file:///x", "nope", 3]) fails(() => requireExternalUrl(bad), "invalid-url");
  });
});
