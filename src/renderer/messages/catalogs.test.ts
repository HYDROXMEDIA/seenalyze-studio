import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import en from "./en.json";
import { UI_LOCALES } from "../i18n";

type Tree = { [key: string]: string | Tree };

function leafKeys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
  );
}

function valueAt(tree: Tree, dotted: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of dotted.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

const MESSAGES = import.meta.dir;
const expectedKeys = leafKeys(en as Tree).sort();

describe("interface catalogs", () => {
  test("every supported interface language has a catalog file", () => {
    const files = new Set(readdirSync(MESSAGES));
    const missing = UI_LOCALES.filter((locale) => !files.has(`${locale}.json`));
    expect(missing).toEqual([]);
  });

  test("every catalog has exactly the English keys and keeps placeholders", () => {
    const problems: string[] = [];
    for (const locale of UI_LOCALES) {
      if (locale === "en") continue;
      const catalog = JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8")) as Tree;
      const keys = leafKeys(catalog).sort();
      const missing = expectedKeys.filter((key) => !keys.includes(key));
      const extra = keys.filter((key) => !expectedKeys.includes(key));
      if (missing.length > 0) problems.push(`${locale} missing: ${missing.slice(0, 5).join(", ")}`);
      if (extra.length > 0) problems.push(`${locale} extra: ${extra.slice(0, 5).join(", ")}`);
      for (const key of expectedKeys) {
        const source = valueAt(en as Tree, key) ?? "";
        const target = valueAt(catalog, key) ?? "";
        for (const placeholder of source.match(/\{[a-zA-Z]+\}/g) ?? []) {
          if (!target.includes(placeholder)) problems.push(`${locale} ${key} lost ${placeholder}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
