// Chooses which microphone the "system default" setting opens. When the
// system default input is a Bluetooth headset, opening its microphone switches
// the headset to its call mode, which lowers and degrades all playback, so a
// wired or built-in microphone is used instead. A Bluetooth microphone the
// user picked explicitly is still opened as chosen.

import { execFile } from "node:child_process";

interface AudioInput {
  uid: string;
  transport: "bluetooth" | "builtIn" | "usb" | "virtual" | "other";
  isDefault: boolean;
}

/** `ok: false` when the device check couldn't run (helper missing or failed, or its output unreadable). */
export type InputCheck<T> = { ok: true; value: T } | { ok: false };

const HELPER_TIMEOUT_MS = 3000;
/** Preferred replacements for a Bluetooth default, best first. */
const PREFERRED_TRANSPORTS: AudioInput["transport"][] = ["usb", "builtIn", "other"];

export function pickDefaultMicrophone(inputs: AudioInput[]): string | undefined {
  const current = inputs.find((input) => input.isDefault);
  if (!current || current.transport !== "bluetooth") return undefined;
  for (const transport of PREFERRED_TRANSPORTS) {
    const match = inputs.find((input) => input.transport === transport);
    if (match) return match.uid;
  }
  return undefined;
}

/**
 * Input devices by UID and name, read without opening any of them (used for
 * a muted microphone whose device stays closed). Empty on other systems.
 */
export function listMicrophones(helper: string): Promise<InputCheck<{ uid: string; name: string }[]>> {
  if (process.platform !== "darwin") return Promise.resolve({ ok: true, value: [] });
  return readInputs(helper, (inputs) =>
    (inputs as { uid?: unknown; name?: unknown }[]).flatMap((input) =>
      typeof input.uid === "string" && input.uid ? [{ uid: input.uid, name: typeof input.name === "string" && input.name ? input.name : input.uid }] : [],
    ),
  );
}

/** Device UID to open in place of the system default, or undefined to keep it. */
export function resolveDefaultMicrophone(helper: string): Promise<InputCheck<string | undefined>> {
  if (process.platform !== "darwin") return Promise.resolve({ ok: true, value: undefined });
  return readInputs(helper, (inputs) => pickDefaultMicrophone(inputs as AudioInput[]));
}

function readInputs<T>(helper: string, parse: (inputs: unknown[]) => T): Promise<InputCheck<T>> {
  return new Promise((resolve) => {
    execFile(helper, [], { timeout: HELPER_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        console.error("[audio-inputs] could not list input devices", error.message);
        resolve({ ok: false });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { inputs?: unknown };
        if (!Array.isArray(parsed.inputs)) throw new Error("no inputs list");
        resolve({ ok: true, value: parse(parsed.inputs) });
      } catch (parseError) {
        console.error("[audio-inputs] unreadable device list", parseError instanceof Error ? parseError.message : String(parseError));
        resolve({ ok: false });
      }
    });
  });
}
