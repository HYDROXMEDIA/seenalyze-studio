// Global hotkeys: action ids, the key-combo format and its validation.
// Combos are stored as Electron accelerators with a fixed modifier order
// ("Control+Alt+Shift+Meta+Key"), so the same string registers a global
// shortcut, matches a held key, and compares equal for conflict checks.
// No Electron/Node imports: the renderer uses this too.

/** Actions with a fixed id; scene and audio actions carry the target name. */
export const FIXED_HOTKEY_ACTIONS = ["goLive", "endStream", "toggleRecording", "saveReplay", "transition", "toggleVirtualCamera"] as const;
export type FixedHotkeyAction = (typeof FIXED_HOTKEY_ACTIONS)[number];

/** Per-target actions, written as `${kind}:${name}`. */
export const TARGET_HOTKEY_KINDS = ["scene", "mute", "pushToTalk", "pushToMute"] as const;
export type TargetHotkeyKind = (typeof TARGET_HOTKEY_KINDS)[number];

/** Actions that act while the keys are held (key down and key up). */
export const HOLD_HOTKEY_KINDS: readonly TargetHotkeyKind[] = ["pushToTalk", "pushToMute"];

export type ParsedHotkeyAction = { kind: FixedHotkeyAction } | { kind: TargetHotkeyKind; target: string };

export const MAX_HOTKEY_BINDINGS = 400;
const MAX_TARGET_LENGTH = 256;

export function targetAction(kind: TargetHotkeyKind, target: string): string {
  return `${kind}:${target}`;
}

export function parseHotkeyAction(action: unknown): ParsedHotkeyAction | null {
  if (typeof action !== "string") return null;
  if ((FIXED_HOTKEY_ACTIONS as readonly string[]).includes(action)) return { kind: action as FixedHotkeyAction };
  const split = action.indexOf(":");
  if (split <= 0) return null;
  const kind = action.slice(0, split);
  const target = action.slice(split + 1);
  if (!(TARGET_HOTKEY_KINDS as readonly string[]).includes(kind) || !target || target.length > MAX_TARGET_LENGTH) return null;
  return { kind: kind as TargetHotkeyKind, target };
}

export function isHoldAction(action: string): boolean {
  const parsed = parseHotkeyAction(action);
  return parsed !== null && "target" in parsed && HOLD_HOTKEY_KINDS.includes(parsed.kind);
}

// ----- keys -------------------------------------------------------------------

/** "typing" keys produce text or move the caret; a global shortcut on them alone would steal typing everywhere. */
interface KeyDef {
  /** Electron accelerator key name. */
  name: string;
  /** KeyboardEvent.code values that produce it. */
  codes: string[];
  /** uiohook key code, for held keys. */
  hook: number;
  typing: boolean;
}

const LETTER_HOOK: Record<string, number> = {
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36, K: 37, L: 38, M: 50,
  N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44,
};
const DIGIT_HOOK = [11, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const NUMPAD_HOOK = [82, 79, 80, 81, 75, 76, 77, 71, 72, 73];
const FUNCTION_HOOK = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88, 91, 92, 93, 99, 100, 101, 102, 103, 104, 105, 106, 107];

const KEYS: KeyDef[] = [
  ...Object.entries(LETTER_HOOK).map(([letter, hook]) => ({ name: letter, codes: [`Key${letter}`], hook, typing: true })),
  ...DIGIT_HOOK.map((hook, digit) => ({ name: String(digit), codes: [`Digit${digit}`], hook, typing: true })),
  ...NUMPAD_HOOK.map((hook, digit) => ({ name: `num${digit}`, codes: [`Numpad${digit}`], hook, typing: false })),
  ...FUNCTION_HOOK.map((hook, index) => ({ name: `F${index + 1}`, codes: [`F${index + 1}`], hook, typing: false })),
  { name: "numdec", codes: ["NumpadDecimal"], hook: 83, typing: false },
  { name: "numadd", codes: ["NumpadAdd"], hook: 78, typing: false },
  { name: "numsub", codes: ["NumpadSubtract"], hook: 74, typing: false },
  { name: "nummult", codes: ["NumpadMultiply"], hook: 55, typing: false },
  { name: "numdiv", codes: ["NumpadDivide"], hook: 3637, typing: false },
  { name: "Space", codes: ["Space"], hook: 57, typing: true },
  { name: "Tab", codes: ["Tab"], hook: 15, typing: true },
  { name: "Backspace", codes: ["Backspace"], hook: 14, typing: true },
  { name: "Delete", codes: ["Delete"], hook: 3667, typing: true },
  { name: "Insert", codes: ["Insert"], hook: 3666, typing: false },
  { name: "Return", codes: ["Enter", "NumpadEnter"], hook: 28, typing: true },
  { name: "Escape", codes: ["Escape"], hook: 1, typing: true },
  { name: "Up", codes: ["ArrowUp"], hook: 57416, typing: true },
  { name: "Down", codes: ["ArrowDown"], hook: 57424, typing: true },
  { name: "Left", codes: ["ArrowLeft"], hook: 57419, typing: true },
  { name: "Right", codes: ["ArrowRight"], hook: 57421, typing: true },
  { name: "Home", codes: ["Home"], hook: 3655, typing: true },
  { name: "End", codes: ["End"], hook: 3663, typing: true },
  { name: "PageUp", codes: ["PageUp"], hook: 3657, typing: true },
  { name: "PageDown", codes: ["PageDown"], hook: 3665, typing: true },
  { name: "PrintScreen", codes: ["PrintScreen"], hook: 3639, typing: false },
  { name: ",", codes: ["Comma"], hook: 51, typing: true },
  { name: "-", codes: ["Minus"], hook: 12, typing: true },
  { name: ".", codes: ["Period"], hook: 52, typing: true },
  { name: "/", codes: ["Slash"], hook: 53, typing: true },
  { name: ";", codes: ["Semicolon"], hook: 39, typing: true },
  { name: "'", codes: ["Quote"], hook: 40, typing: true },
  { name: "[", codes: ["BracketLeft"], hook: 26, typing: true },
  { name: "]", codes: ["BracketRight"], hook: 27, typing: true },
  { name: "\\", codes: ["Backslash"], hook: 43, typing: true },
  { name: "`", codes: ["Backquote"], hook: 41, typing: true },
  { name: "=", codes: ["Equal"], hook: 13, typing: true },
];

const KEY_BY_NAME = new Map(KEYS.map((key) => [key.name, key]));
const KEY_BY_CODE = new Map(KEYS.flatMap((key) => key.codes.map((code) => [code, key] as const)));

export const MODIFIERS = ["Control", "Alt", "Shift", "Meta"] as const;
export type Modifier = (typeof MODIFIERS)[number];

export interface Hotkey {
  modifiers: Modifier[];
  key: string;
}

export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export function formatHotkey(hotkey: Hotkey): string {
  return [...MODIFIERS.filter((modifier) => hotkey.modifiers.includes(modifier)), hotkey.key].join("+");
}

/** Parses a stored combo; anything not in the canonical format is rejected. */
export function parseHotkey(value: unknown): Hotkey | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  // The key itself may be "+"-free punctuation; split on "+" that separates parts.
  const parts = value.split("+");
  const key = parts.pop();
  if (!key || !KEY_BY_NAME.has(key)) return null;
  const modifiers: Modifier[] = [];
  for (const part of parts) {
    if (!(MODIFIERS as readonly string[]).includes(part) || modifiers.includes(part as Modifier)) return null;
    modifiers.push(part as Modifier);
  }
  const hotkey = { modifiers, key };
  return formatHotkey(hotkey) === value ? hotkey : null;
}

/**
 * The combo a key press stands for, or null while only modifiers are held or
 * for keys hotkeys do not support.
 */
export function hotkeyFromKeyEvent(event: KeyEventLike): string | null {
  const key = KEY_BY_CODE.get(event.code);
  if (!key) return null;
  const modifiers: Modifier[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  return formatHotkey({ modifiers, key: key.name });
}

/** uiohook key code of the combo's main key. */
export function hookKeyCode(hotkey: Hotkey): number | null {
  return KEY_BY_NAME.get(hotkey.key)?.hook ?? null;
}

export type HotkeyProblem = "invalid" | "needsModifier";

/**
 * One-shot actions are global shortcuts, which take the keys away from every
 * other app; a typing key needs a modifier other than Shift so typing keeps
 * working. Held actions only listen, so any key works.
 */
export function hotkeyProblem(action: string, combo: string): HotkeyProblem | null {
  const hotkey = parseHotkey(combo);
  if (!hotkey || !parseHotkeyAction(action)) return "invalid";
  if (isHoldAction(action)) return null;
  const typing = KEY_BY_NAME.get(hotkey.key)?.typing ?? true;
  const strong = hotkey.modifiers.some((modifier) => modifier !== "Shift");
  return typing && !strong ? "needsModifier" : null;
}

/**
 * Combos the operating system or every app already uses. Binding them would
 * either never fire or break the shortcut everywhere.
 */
export function isReservedHotkey(combo: string, platform: string): boolean {
  const mac = platform === "darwin";
  const reserved = mac
    ? ["Meta+Q", "Meta+W", "Meta+H", "Meta+M", "Meta+Tab", "Meta+Space", "Meta+C", "Meta+V", "Meta+X", "Meta+Z", "Shift+Meta+Z", "Meta+A", "Meta+S", "Meta+F", "Meta+,", "Control+Meta+Q", "Control+Meta+F", "Shift+Meta+3", "Shift+Meta+4", "Shift+Meta+5"]
    : ["Alt+F4", "Alt+Tab", "Control+C", "Control+V", "Control+X", "Control+Z", "Control+Y", "Control+A", "Control+S", "Control+F", "Control+Alt+Delete", "Control+Shift+Escape", "Meta+L", "Meta+D", "Meta+Tab", "Meta+E", "Meta+R"];
  return reserved.includes(combo);
}

/** Actions sharing a combo with another action, mapped to those other actions. */
export function findHotkeyConflicts(bindings: Record<string, string>): Map<string, string[]> {
  const byCombo = new Map<string, string[]>();
  for (const [action, combo] of Object.entries(bindings)) {
    if (!combo) continue;
    byCombo.set(combo, [...(byCombo.get(combo) ?? []), action]);
  }
  const conflicts = new Map<string, string[]>();
  for (const actions of byCombo.values()) {
    if (actions.length < 2) continue;
    for (const action of actions) conflicts.set(action, actions.filter((other) => other !== action));
  }
  return conflicts;
}

/** Keeps only well-formed bindings (persisted state and IPC input are untrusted). */
export function sanitizeHotkeys(value: unknown): Record<string, string> {
  const clean: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return clean;
  for (const [action, combo] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(clean).length >= MAX_HOTKEY_BINDINGS) break;
    if (typeof combo === "string" && hotkeyProblem(action, combo) === null) clean[action] = combo;
  }
  return clean;
}

/** Moves bindings of a renamed scene or audio source to its new name. */
export function renameHotkeyTarget(bindings: Record<string, string>, kinds: readonly TargetHotkeyKind[], from: string, to: string): Record<string, string> {
  if (from === to) return bindings;
  const next = { ...bindings };
  for (const kind of kinds) {
    const old = targetAction(kind, from);
    if (!(old in next)) continue;
    next[targetAction(kind, to)] = next[old];
    delete next[old];
  }
  return next;
}

const MAC_SYMBOLS: Record<Modifier, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
const PC_NAMES: Record<Modifier, string> = { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };
const KEY_LABELS: Record<string, string> = {
  Return: "↵",
  Escape: "Esc",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  numdec: "Num .",
  numadd: "Num +",
  numsub: "Num -",
  nummult: "Num *",
  numdiv: "Num /",
};

/** Display text for a combo, in the platform's usual notation. */
export function displayHotkey(combo: string, platform: string): string {
  const hotkey = parseHotkey(combo);
  if (!hotkey) return combo;
  const mac = platform === "darwin";
  const key = KEY_LABELS[hotkey.key] ?? (hotkey.key.startsWith("num") ? `Num ${hotkey.key.slice(3)}` : hotkey.key);
  if (mac) return `${hotkey.modifiers.map((modifier) => MAC_SYMBOLS[modifier]).join("")}${key}`;
  return [...hotkey.modifiers.map((modifier) => PC_NAMES[modifier]), key].join("+");
}
