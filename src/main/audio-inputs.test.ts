import { describe, expect, test } from "bun:test";
import { pickDefaultMicrophone } from "./audio-inputs";

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
