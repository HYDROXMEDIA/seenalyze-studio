import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let resolveSubscription: (() => void) | null = null;
mock.module("../platforms/twitch", () => ({
  createEventSubSubscription: () =>
    new Promise<void>((resolve) => {
      resolveSubscription = resolve;
    }),
}));

class FakeSocket {
  static all: FakeSocket[] = [];
  readonly listeners = new Map<string, ((event: { data?: string; type?: string }) => void)[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, listener: (event: { data?: string; type?: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: { data?: string; type?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  message(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
}

const realWebSocket = globalThis.WebSocket;
beforeEach(() => {
  FakeSocket.all = [];
  resolveSubscription = null;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  globalThis.WebSocket = realWebSocket;
});

const { TwitchEventSub } = await import("./twitch-eventsub");
const account = { id: "a", channelId: "1" } as ConstructorParameters<typeof TwitchEventSub>[0];
const welcome = (id: string) => ({ metadata: { message_type: "session_welcome" }, payload: { session: { id, keepalive_timeout_seconds: 10 } } });

describe("Twitch EventSub lifecycle", () => {
  test("a subscription that finishes after stop does not report connected", async () => {
    const states: string[] = [];
    const feed = new TwitchEventSub(account, () => undefined, (state) => states.push(state));
    feed.start();
    FakeSocket.all[0].message(welcome("s1"));
    feed.stop();
    resolveSubscription?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toBe("offline");
    expect(states).not.toContain("connected");
  });

  test("a failed reconnect handoff closes the old socket", () => {
    const feed = new TwitchEventSub(account, () => undefined, () => undefined);
    feed.start();
    const first = FakeSocket.all[0];
    first.message({ metadata: { message_type: "session_reconnect" }, payload: { session: { reconnect_url: "wss://example.invalid/ws" } } });
    const handoff = FakeSocket.all[1];
    handoff.close();
    expect(first.closed).toBe(true);
    feed.stop();
  });
});
