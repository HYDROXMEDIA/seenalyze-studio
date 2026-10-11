import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listMicrophones, pickDefaultMicrophone, resolveDefaultMicrophone } from "./audio-inputs";

describe("pickDefaultMicrophone", () => {
  test("keeps a non-Bluetooth default", () => {
    expect(pickDefaultMicrophone([{ uid: "usb", transport: "usb", isDefault: true }, { uid: "bt", transport: "bluetooth", isDefault: false }])).toBeUndefined();
  });
  test("replaces a Bluetooth default with a wired microphone first", () => {
    expect(
      pickDefaultMicrophone([
        { uid: "bt", transport: "bluetooth", isDefault: true },
        { uid: "mac", transport: "builtIn", isDefault: false },
        { uid: "usb", transport: "usb", isDefault: false },
      ]),
    ).toBe("usb");
  });
  test("never picks virtual devices and keeps the default when nothing else fits", () => {
    expect(pickDefaultMicrophone([{ uid: "bt", transport: "bluetooth", isDefault: true }, { uid: "v", transport: "virtual", isDefault: false }])).toBeUndefined();
  });
});

// The helper only runs on macOS; elsewhere both checks report nothing to change.
describe.skipIf(process.platform !== "darwin")("device check helper", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "audio-inputs-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function helper(name: string, output: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\nprintf '%s' '${output}'\n`);
    chmodSync(file, 0o755);
    return file;
  }

  test("reads devices from the helper", async () => {
    const file = helper(
      "ok",
      JSON.stringify({ inputs: [{ uid: "bt", name: "Headset", transport: "bluetooth", isDefault: true }, { uid: "mac", name: "", transport: "builtIn", isDefault: false }] }),
    );
    expect(await listMicrophones(file)).toEqual({ ok: true, value: [{ uid: "bt", name: "Headset" }, { uid: "mac", name: "mac" }] });
    expect(await resolveDefaultMicrophone(file)).toEqual({ ok: true, value: "mac" });
  });

  test("reports a missing helper as a failed check, not as no devices", async () => {
    const missing = path.join(dir, "not-there");
    expect(await listMicrophones(missing)).toEqual({ ok: false });
    expect(await resolveDefaultMicrophone(missing)).toEqual({ ok: false });
  });

  test("reports unreadable helper output as a failed check", async () => {
    for (const output of ["", "not json", "{}", "null"]) {
      const file = helper(`bad-${output.length}`, output);
      expect(await listMicrophones(file)).toEqual({ ok: false });
      expect(await resolveDefaultMicrophone(file)).toEqual({ ok: false });
    }
  });
});
