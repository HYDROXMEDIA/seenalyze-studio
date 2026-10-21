import { describe, expect, test } from "bun:test";
import { SnapshotGate } from "./snapshot-gate";

describe("snapshot gate", () => {
  test("an unchanged tick sends nothing", () => {
    const gate = new SnapshotGate();
    const snapshot = { ready: true, destinationStatus: [{ id: "a", kbps: 6000 }] };
    expect(gate.changed(snapshot)).toBe(true);
    expect(gate.changed({ ready: true, destinationStatus: [{ id: "a", kbps: 6000 }] })).toBe(false);
    expect(gate.changed(snapshot)).toBe(false);
  });

  test("a changed value is sent, and reset lets the same snapshot through again", () => {
    const gate = new SnapshotGate();
    gate.changed({ kbps: 6000 });
    expect(gate.changed({ kbps: 5900 })).toBe(true);
    expect(gate.changed({ kbps: 5900 })).toBe(false);
    gate.reset();
    expect(gate.changed({ kbps: 5900 })).toBe(true);
  });
});
