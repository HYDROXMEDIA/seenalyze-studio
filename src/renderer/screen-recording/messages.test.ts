import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import en from "../messages/en.json";

type Tree = { [key: string]: string | Tree };

const CATALOG = (en as unknown as { screenRecording: Tree }).screenRecording;

function has(dotted: string): boolean {
  let node: string | Tree | undefined = CATALOG;
  for (const part of dotted.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = node[part];
  }
  return typeof node === "string";
}

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return /\.(html|js)$/u.test(entry.name) ? [full] : [];
  });
}

describe("screen-recording messages", () => {
  test("keys in page markup and scripts exist", () => {
    const missing: string[] = [];
    for (const file of pageFiles(import.meta.dir)) {
      const source = readFileSync(file, "utf8");
      const keys = [
        ...[...source.matchAll(/data-i18n="([^"]+)"/gu)].map((match) => match[1]),
        ...[...source.matchAll(/data-i18n-attr="([^"]+)"/gu)].flatMap((match) => match[1].split(";").map((pair) => pair.split(":")[1].trim())),
        ...[...source.matchAll(/\bt\('([\w.-]+)'/gu)].map((match) => match[1]),
        ...[...source.matchAll(/'((?:editor|capture|controls|recorder)\.[\w.-]+)'/gu)].map((match) => match[1]),
      ];
      for (const key of keys) if (!has(key)) missing.push(`${path.relative(import.meta.dir, file)}: ${key}`);
    }
    expect(missing).toEqual([]);
  });

  test("keys built from runtime values exist", () => {
    const dynamic = [
      ...["dusk", "ocean", "meadow", "graphite", "paper", "none", "image"].map((k) => `editor.background.${k}`),
      ...["circle", "rounded", "square"].map((k) => `editor.camera.shapes.${k}`),
      ...["top-left", "top-right", "bottom-left", "bottom-right"].map((k) => `editor.camera.positions.${k}`),
      ...["none", "soft", "crisp", "pop", "mechanical", "typewriter"].map((k) => `editor.sounds.styles.${k}`),
      ...["small", "medium", "large"].map((k) => `editor.keys.sizes.${k}`),
      ...["bottom", "top"].map((k) => `editor.keys.positions.${k}`),
      ...["dark", "light", "orange", "blue", "green"].map((k) => `editor.keys.colors.${k}`),
      ...["standard", "high", "max"].map((k) => `editor.export.qualities.${k}`),
    ];
    expect(dynamic.filter((key) => !has(key))).toEqual([]);
  });

  test("main-process dialog keys exist", () => {
    const mainDir = path.join(import.meta.dir, "..", "..", "main", "screen-recording");
    const missing: string[] = [];
    for (const file of readdirSync(mainDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
      for (const match of readFileSync(path.join(mainDir, file), "utf8").matchAll(/\bt\('([\w.-]+)'/gu)) {
        if (!has(`main.${match[1]}`)) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
