import { describe, expect, test } from "bun:test";
import { broadcastPrivacy, clampVolume, isWebUrl } from "./limits";

describe("limits checked before values go to the main process", () => {
  test("only http(s) addresses with a host count as web page addresses", () => {
    expect(isWebUrl("https://example.com/overlay")).toBe(true);
    expect(isWebUrl("http://127.0.0.1:47821/chat")).toBe(true);
    expect(isWebUrl("  https://example.com  ")).toBe(true);
    expect(isWebUrl("example.com")).toBe(false);
    expect(isWebUrl("https://")).toBe(false);
    expect(isWebUrl("about:blank")).toBe(false);
    expect(isWebUrl("file:///etc/passwd")).toBe(false);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("")).toBe(false);
    expect(isWebUrl(42)).toBe(false);
  });

  test("broadcast privacy is always one of the three allowed values", () => {
    expect(broadcastPrivacy("unlisted")).toBe("unlisted");
    expect(broadcastPrivacy("private")).toBe("private");
    expect(broadcastPrivacy(undefined)).toBe("public");
    expect(broadcastPrivacy("friends")).toBe("public");
  });

  test("volume stays between silent and full", () => {
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(-0.1)).toBe(0);
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(Number.NaN)).toBeNull();
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
