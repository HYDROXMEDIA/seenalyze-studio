import { describe, expect, test } from "bun:test";
import { deflectionToDb, formatDb, MIN_DB, meterChannels, meterDeflection } from "./audio-meter";

describe("deflectionToDb", () => {
  test("covers the fader ends", () => {
    expect(deflectionToDb(1)).toBe(0);
    expect(deflectionToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(deflectionToDb(Number.NaN)).toBe(Number.NEGATIVE_INFINITY);
  });

  test("inverts the meter scale on the shared range", () => {
    for (const db of [-3, -9, -15, -20, -27, -35, -45, -55]) {
      expect(deflectionToDb(meterDeflection(db))).toBeCloseTo(db, 5);
    }
  });

  test("is continuous and increasing", () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let step = 1; step <= 1000; step += 1) {
      const db = deflectionToDb(step / 1000);
      expect(db).toBeGreaterThan(previous);
      if (Number.isFinite(previous)) expect(db - previous).toBeLessThan(1);
      previous = db;
    }
  });
});

describe("formatDb", () => {
  test("formats with one decimal", () => {
    expect(formatDb(0)).toBe("0.0 dB");
    expect(formatDb(-0.04)).toBe("0.0 dB");
    expect(formatDb(-6.25)).toBe("-6.2 dB");
    expect(formatDb(Number.NEGATIVE_INFINITY)).toBe("-∞ dB");
  });
});

describe("meterChannels", () => {
  test("keeps left and right, replaces invalid values", () => {
    expect(meterChannels([-10, -12, -30])).toEqual([-10, -12]);
    expect(meterChannels([Number.NEGATIVE_INFINITY])).toEqual([MIN_DB]);
    expect(meterChannels(undefined)).toEqual([MIN_DB]);
  });
});
