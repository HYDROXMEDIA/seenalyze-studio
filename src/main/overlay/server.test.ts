import { afterEach, describe, expect, test } from "bun:test";
import type { ChatEvent, ChatMessage } from "../../shared/types";
import { OverlayServer } from "./server";

const message: ChatMessage = {
  id: "twitch:1",
  platform: "twitch",
  accountId: "twitch:42",
  authorId: "7",
  authorName: "Viewer",
  badges: [],
  segments: [{ type: "text", text: "<b>hello</b>" }],
  timestamp: 0,
};

function feed(initial: ChatMessage[] = []) {
  const listeners = new Set<(event: ChatEvent) => void>();
  return {
    listeners,
    state: () => ({ messages: initial, sources: [] }),
    subscribe(listener: (event: ChatEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(event: ChatEvent) {
      for (const listener of listeners) listener(event);
    },
  };
}

let server: OverlayServer | null = null;
afterEach(() => {
  server?.stop();
  server = null;
});

describe("overlay server", () => {
  test("serves the chat page with a strict content policy", async () => {
    server = new OverlayServer(feed());
    await server.start(0);
    const response = await fetch(server.chatUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain("EventSource");
    // Message text is inserted as text nodes, never as HTML.
    expect(html).not.toContain("innerHTML = message");
  });

  test("streams the current messages, then live events, and unsubscribes on disconnect", async () => {
    const source = feed([message]);
    server = new OverlayServer(source);
    await server.start(0);
    const controller = new AbortController();
    const response = await fetch(server.chatUrl.replace("/overlay/chat", "/overlay/events"), { signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const read = async () => decoder.decode((await reader.read()).value);

    expect(await read()).toContain('"type":"state"');
    expect(source.listeners.size).toBe(1);
    source.push({ type: "messages", messages: [{ ...message, id: "twitch:2" }] });
    expect(await read()).toContain("twitch:2");

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(source.listeners.size).toBe(0);
  });

  test("falls back to another port when the preferred one is taken", async () => {
    const first = new OverlayServer(feed());
    const port = await first.start(0);
    server = new OverlayServer(feed());
    const second = await server.start(port);
    expect(second).not.toBe(port);
    first.stop();
  });

  test("rejects anything but GET and unknown paths", async () => {
    server = new OverlayServer(feed());
    await server.start(0);
    const base = server.chatUrl.replace("/overlay/chat", "");
    expect((await fetch(`${base}/overlay/chat`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/secrets`)).status).toBe(404);
  });
});
