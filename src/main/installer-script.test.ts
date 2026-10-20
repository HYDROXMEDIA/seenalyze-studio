// Checks the custom Windows installer (build/installer.nsh) without Windows: every string exists in
// every installer language, the hero picture is a 500 x 160 bitmap, and installs stay per-user.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..");
const script = readFileSync(path.join(root, "build", "installer.nsh"), "utf8");
const builderConfig = readFileSync(path.join(root, "electron-builder.yml"), "utf8");
// electron-builder language code -> the NSIS language constant the strings use.
const NSIS_NAMES: Record<string, string> = {
  en_US: "ENGLISH",
  hu_HU: "HUNGARIAN",
  de_DE: "GERMAN",
  cs_CZ: "CZECH",
  es_ES: "SPANISHINTERNATIONAL",
  pt_BR: "PORTUGUESEBR",
  hr_HR: "CROATIAN",
};

function installerLanguages(): string[] {
  const block = /installerLanguages:\n((?:\s+- \w+\n)+)/u.exec(builderConfig);
  if (!block) throw new Error("nsis.installerLanguages is missing from electron-builder.yml");
  return [...block[1].matchAll(/- (\w+)/gu)].map((match) => match[1]);
}

describe("Windows installer script", () => {
  test("has every string in every installer language", () => {
    const keys = new Set([...script.matchAll(/LangString (STUDIO_\w+) /gu)].map((match) => match[1]));
    expect(keys.size).toBeGreaterThan(0);
    const languages = installerLanguages();
    expect(languages).toContain("en_US");
    for (const code of languages) {
      const name = NSIS_NAMES[code];
      expect(name, `${code} has no NSIS language name in this test`).toBeDefined();
      for (const key of keys) {
        expect(script, `${key} is missing for ${code}`).toMatch(new RegExp(`LangString ${key} \\$\\{LANG_${name}\\} "[^"]+"`, "u"));
      }
    }
  });

  test("defines every string it uses, and the hero picture is a 500 x 160 bitmap", () => {
    const defined = new Set([...script.matchAll(/LangString (STUDIO_\w+) /gu)].map((match) => match[1]));
    for (const used of script.matchAll(/\$\((STUDIO_\w+)\)/gu)) expect(defined.has(used[1]), `${used[1]} is used but not defined`).toBe(true);
    const hero = path.join(root, "build", "installer", "hero.bmp");
    expect(existsSync(hero)).toBe(true);
    const bytes = readFileSync(hero);
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("BM");
    expect(bytes.readInt32LE(18)).toBe(500);
    expect(Math.abs(bytes.readInt32LE(22))).toBe(160);
    expect(bytes.readUInt16LE(28)).toBe(24);
  });

  test("installs per-user without an administrator prompt, always inside an app folder", () => {
    expect(builderConfig).toMatch(/perMachine: false/u);
    expect(script).toMatch(/isForceCurrentInstall "1"/u);
    expect(script).toMatch(/StrCpy \$INSTDIR "\$INSTDIR\\\$\{APP_FILENAME\}"/u);
    expect(script).not.toMatch(/RequestExecutionLevel admin/u);
  });
});
