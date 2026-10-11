import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("packaged macOS helpers", () => {
  test("every helper the app builds or runs is shipped in the app", () => {
    const config = Bun.YAML.parse(readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8")) as { mac?: { extraResources?: { from?: string; filter?: string[] }[] } };
    const shipped = new Set(config.mac?.extraResources?.find((entry) => entry.from === "bin")?.filter ?? []);
    const built = [...readFileSync(path.join(ROOT, "scripts", "build-native.mjs"), "utf8").matchAll(/output: "([\w-]+)"/gu)].map((match) => match[1]);
    const used = sourceFiles(path.join(ROOT, "src", "main")).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/helperPath\(["']([\w-]+)["']\)/gu)].map((match) => match[1]));
    expect(built.length).toBeGreaterThan(0);
    expect(used.length).toBeGreaterThan(0);
    expect([...new Set([...built, ...used])].filter((name) => !shipped.has(name))).toEqual([]);
  });
});
