import { describe, expect, test } from "bun:test";
import {
  displayHotkey,
  findHotkeyConflicts,
  hookKeyCode,
  hotkeyFromKeyEvent,
  hotkeyProblem,
  isHoldAction,
  isReservedHotkey,
  parseHotkey,
  parseHotkeyAction,
  renameHotkeyTarget,
  sanitizeHotkeys,
} from "./hotkeys";

const press = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("hotkey combos", () => {
  test("key events become canonical combos with a fixed modifier order", () => {
    expect(hotkeyFromKeyEvent(press("KeyR", { metaKey: true, shiftKey: true, ctrlKey: true }))).toBe("Control+Shift+Meta+R");
    expect(hotkeyFromKeyEvent(press("Digit1", { altKey: true }))).toBe("Alt+1");
    expect(hotkeyFromKeyEvent(press("NumpadEnter"))).toBe("Return");
    expect(hotkeyFromKeyEvent(press("F13"))).toBe("F13");
    expect(hotkeyFromKeyEvent(press("Comma", { ctrlKey: true }))).toBe("Control+,");
  });

  test("modifier-only and unknown keys produce nothing", () => {
    expect(hotkeyFromKeyEvent(press("ShiftLeft", { shiftKey: true }))).toBeNull();
    expect(hotkeyFromKeyEvent(press("MetaRight", { metaKey: true }))).toBeNull();
    expect(hotkeyFromKeyEvent(press("IntlBackslash"))).toBeNull();
  });

  test("parsing accepts only the canonical form", () => {
    expect(parseHotkey("Control+Alt+K")).toEqual({ modifiers: ["Control", "Alt"], key: "K" });
    expect(parseHotkey("Alt+Control+K")).toBeNull();
    expect(parseHotkey("Control+Control+K")).toBeNull();
    expect(parseHotkey("Hyper+K")).toBeNull();
    expect(parseHotkey("Control+")).toBeNull();
    expect(parseHotkey("")).toBeNull();
    expect(parseHotkey(42)).toBeNull();
  });

  test("held keys map to hook key codes", () => {
    expect(hookKeyCode({ modifiers: [], key: "V" })).toBe(47);
    expect(hookKeyCode({ modifiers: [], key: "F1" })).toBe(59);
    expect(hookKeyCode({ modifiers: [], key: "num5" })).toBe(76);
  });

  test("display follows the platform's notation", () => {
    expect(displayHotkey("Control+Shift+Meta+R", "darwin")).toBe("⌃⇧⌘R");
    expect(displayHotkey("Control+Alt+Up", "win32")).toBe("Ctrl+Alt+↑");
    expect(displayHotkey("num7", "win32")).toBe("Num 7");
  });
});

describe("hotkey actions", () => {
  test("fixed and per-target actions parse; others are rejected", () => {
    expect(parseHotkeyAction("goLive")).toEqual({ kind: "goLive" });
    expect(parseHotkeyAction("scene:Just: chatting")).toEqual({ kind: "scene", target: "Just: chatting" });
    expect(parseHotkeyAction("mute:")).toBeNull();
    expect(parseHotkeyAction("explode:Mic")).toBeNull();
    expect(isHoldAction("pushToTalk:Mic")).toBe(true);
    expect(isHoldAction("mute:Mic")).toBe(false);
  });

  test("global shortcuts on typing keys need a real modifier; held keys do not", () => {
    expect(hotkeyProblem("goLive", "K")).toBe("needsModifier");
    expect(hotkeyProblem("goLive", "Shift+K")).toBe("needsModifier");
    expect(hotkeyProblem("goLive", "Alt+K")).toBeNull();
    expect(hotkeyProblem("goLive", "F9")).toBeNull();
    expect(hotkeyProblem("pushToTalk:Mic", "V")).toBeNull();
    expect(hotkeyProblem("nope", "Alt+K")).toBe("invalid");
  });

  test("conflicts list every other action on the same combo", () => {
    const conflicts = findHotkeyConflicts({ goLive: "Alt+L", "scene:Main": "Alt+L", endStream: "Alt+E", "mute:Mic": "Alt+L" });
    expect(conflicts.get("goLive")).toEqual(["scene:Main", "mute:Mic"]);
    expect(conflicts.has("endStream")).toBe(false);
  });

  test("system shortcuts are reserved per platform", () => {
    expect(isReservedHotkey("Meta+Q", "darwin")).toBe(true);
    expect(isReservedHotkey("Meta+Q", "win32")).toBe(false);
    expect(isReservedHotkey("Alt+F4", "win32")).toBe(true);
  });

  test("sanitizing drops malformed or unsafe bindings", () => {
    expect(
      sanitizeHotkeys({ goLive: "Alt+L", endStream: "E", "scene:Main": "Bogus+1", "pushToTalk:Mic": "V", toggleRecording: 5, junk: "Alt+J" }),
    ).toEqual({ goLive: "Alt+L", "pushToTalk:Mic": "V" });
    expect(sanitizeHotkeys(null)).toEqual({});
    expect(sanitizeHotkeys(["Alt+L"])).toEqual({});
  });

  test("renaming a target moves its bindings", () => {
    const next = renameHotkeyTarget({ "mute:Mic": "Alt+M", "pushToTalk:Mic": "V", "scene:Mic": "Alt+1" }, ["mute", "pushToTalk", "pushToMute"], "Mic", "Voice");
    expect(next).toEqual({ "mute:Voice": "Alt+M", "pushToTalk:Voice": "V", "scene:Mic": "Alt+1" });
  });
});
