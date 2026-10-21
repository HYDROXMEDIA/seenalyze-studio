import { describe, expect, test } from "bun:test";
import { shareUnchanged } from "./share-snapshot";

describe("shareUnchanged", () => {
  test("the first snapshot is used as is", () => {
    const next = { accounts: [{ id: "a" }] };
    expect(shareUnchanged(null, next)).toBe(next);
  });

  test("an identical snapshot keeps the previous object", () => {
    const previous = { accounts: [{ id: "a" }], ready: true };
    expect(shareUnchanged(previous, { accounts: [{ id: "a" }], ready: true })).toBe(previous);
  });

  test("unchanged parts keep their reference and changed parts are new", () => {
    const previous = { accounts: [{ id: "a" }], recording: { active: false } };
    const next = { accounts: [{ id: "a" }], recording: { active: true } };
    const shared = shareUnchanged(previous, next);
    expect(shared).not.toBe(previous);
    expect(shared.accounts).toBe(previous.accounts);
    expect(shared.recording).toBe(next.recording);
  });

  test("an added or removed key counts as a change", () => {
    const previous: { ready: boolean; engineErrorKey?: string } = { ready: true, engineErrorKey: "x" };
    const shared = shareUnchanged(previous, { ready: true });
    expect(shared).not.toBe(previous);
    expect(shared).toEqual({ ready: true });
  });
});
