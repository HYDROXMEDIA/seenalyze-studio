// Global hotkeys. One-shot actions (go live, scene switch, mute…) are system
// shortcuts, which work while the app is in the background and need no extra
// access. Held actions (push-to-talk, push-to-mute) need key-up events, so they
// listen through the shared input hook. Only the bound combos are compared in
// memory; no other key is kept, logged or sent anywhere.

import { globalShortcut, shell, systemPreferences } from "electron";
import { hookKeyCode, isHoldAction, parseHotkey, type Modifier } from "../shared/hotkeys";
import type { HotkeyStatus } from "../shared/types";
import { acquireInputHook, releaseInputHook, uIOhook } from "./input-hook";

const IS_MAC = process.platform === "darwin";
const MAC_ACCESSIBILITY_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

export interface HotkeyTargets {
  /** A one-shot action's combo was pressed. */
  trigger(action: string): void;
  /** A held action's key went down or up. */
  hold(action: string, down: boolean): void;
}

interface HoldBinding {
  action: string;
  keycode: number;
  modifiers: Modifier[];
}

interface HookKeyEvent {
  keycode: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_FLAGS: Record<Modifier, keyof Omit<HookKeyEvent, "keycode">> = {
  Control: "ctrlKey",
  Alt: "altKey",
  Shift: "shiftKey",
  Meta: "metaKey",
};

export class HotkeyManager {
  private bindings: Record<string, string> = {};
  private signature = "";
  private readonly registered = new Set<string>();
  private unavailable: string[] = [];
  private holds: HoldBinding[] = [];
  private readonly held = new Set<string>();
  private hookRunning = false;
  private inputAccess: HotkeyStatus["inputAccess"] = "unused";
  private capturing = false;
  private disposed = false;

  constructor(
    private readonly targets: HotkeyTargets,
    private readonly onChange: () => void,
  ) {}

  /** Applies the combos for the actions that currently exist; unchanged sets are skipped. */
  apply(bindings: Record<string, string>): void {
    const signature = JSON.stringify(Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b)));
    if (signature === this.signature) return;
    this.signature = signature;
    this.bindings = { ...bindings };
    this.sync();
  }

  /** While the user presses a new combo in Settings, no hotkey may fire or swallow it. */
  setCapturing(active: boolean): void {
    if (this.capturing === active) return;
    this.capturing = active;
    this.sync();
  }

  status(): Pick<HotkeyStatus, "unavailable" | "inputAccess"> {
    return { unavailable: [...this.unavailable], inputAccess: this.inputAccess };
  }

  /** Called when the app regains focus: input access may have been granted meanwhile. */
  recheckInputAccess(): void {
    if (this.inputAccess === "needed" && this.hasInputAccess(false)) this.sync();
  }

  async openInputAccessSettings(): Promise<void> {
    if (!IS_MAC) return;
    // Asking once adds the app to the list in System Settings.
    if (this.hasInputAccess(true)) {
      this.sync();
      return;
    }
    await shell.openExternal(MAC_ACCESSIBILITY_SETTINGS);
  }

  dispose(): void {
    this.disposed = true;
    this.unregisterAll();
    this.stopHook();
  }

  private sync(): void {
    if (this.disposed) return;
    this.unregisterAll();
    this.stopHook();
    this.unavailable = [];
    this.holds = [];
    const oneShots = new Map<string, string[]>();
    for (const [action, combo] of Object.entries(this.bindings)) {
      const hotkey = parseHotkey(combo);
      if (!hotkey) continue;
      if (isHoldAction(action)) {
        const keycode = hookKeyCode(hotkey);
        if (keycode !== null) this.holds.push({ action, keycode, modifiers: hotkey.modifiers });
      } else {
        oneShots.set(combo, [...(oneShots.get(combo) ?? []), action]);
      }
    }
    if (!this.capturing) {
      for (const [combo, actions] of oneShots) this.register(combo, actions);
      if (this.holds.length > 0) this.startHook();
    }
    this.inputAccess = this.holds.length === 0 ? "unused" : this.hookRunning ? "granted" : this.capturing ? this.inputAccess : "needed";
    this.onChange();
  }

  private register(combo: string, actions: string[]): void {
    let ok = false;
    try {
      ok = globalShortcut.register(combo, () => {
        for (const action of actions) this.targets.trigger(action);
      });
    } catch (error) {
      console.error("[hotkeys] a shortcut could not be registered", error);
    }
    if (ok) this.registered.add(combo);
    else this.unavailable.push(combo);
  }

  private unregisterAll(): void {
    for (const combo of this.registered) globalShortcut.unregister(combo);
    this.registered.clear();
  }

  private hasInputAccess(prompt: boolean): boolean {
    return !IS_MAC || systemPreferences.isTrustedAccessibilityClient(prompt);
  }

  private startHook(): void {
    if (this.hookRunning || !this.hasInputAccess(false)) return;
    uIOhook.on("keydown", this.onKeyDown);
    uIOhook.on("keyup", this.onKeyUp);
    try {
      acquireInputHook();
      this.hookRunning = true;
    } catch (error) {
      uIOhook.off("keydown", this.onKeyDown);
      uIOhook.off("keyup", this.onKeyUp);
      console.error("[hotkeys] held keys are unavailable", error instanceof Error ? error.message : "unknown error");
    }
  }

  private stopHook(): void {
    // A held key must not stay "down" (e.g. a microphone left open) when listening stops.
    for (const action of this.held) this.targets.hold(action, false);
    this.held.clear();
    if (!this.hookRunning) return;
    this.hookRunning = false;
    uIOhook.off("keydown", this.onKeyDown);
    uIOhook.off("keyup", this.onKeyUp);
    try {
      releaseInputHook();
    } catch (error) {
      console.error("[hotkeys] input hook did not stop cleanly", error instanceof Error ? error.message : "unknown error");
    }
  }

  // Extra modifiers are allowed so push-to-talk keeps working while, say, Shift is held in a game.
  private readonly onKeyDown = (event: HookKeyEvent): void => {
    for (const hold of this.holds) {
      if (event.keycode !== hold.keycode || this.held.has(hold.action)) continue;
      if (!hold.modifiers.every((modifier) => event[MODIFIER_FLAGS[modifier]])) continue;
      this.held.add(hold.action);
      this.targets.hold(hold.action, true);
    }
  };

  private readonly onKeyUp = (event: HookKeyEvent): void => {
    for (const hold of this.holds) {
      if (event.keycode !== hold.keycode || !this.held.has(hold.action)) continue;
      this.held.delete(hold.action);
      this.targets.hold(hold.action, false);
    }
  };
}
