import { describe, expect, test } from "bun:test";
import { formatBytes } from "./format-bytes";

describe("formatBytes", () => {
  test("picks the unit and rounds", () => {
    expect(formatBytes(0, "en")).toBe("0 byte");
    expect(formatBytes(1_500_000, "en")).toBe("1.5 MB");
    expect(formatBytes(250_000_000_000, "en")).toBe("250 GB");
    expect(formatBytes(2_000_000_000_000, "en")).toBe("2 TB");
  });

  test("treats invalid sizes as empty", () => {
    expect(formatBytes(Number.NaN, "en")).toBe("0 byte");
    expect(formatBytes(-5, "en")).toBe("0 byte");
  });
});
