import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ChatSink } from "./types";

type Page = { items: never[]; nextPageToken?: string; pollingIntervalMillis?: number; offlineAt?: string };
const calls = { active: 0, list: [] as (string | undefined)[] };
let activeChat: () => Promise<string | null> = async () => "chat-1";
let listPage: () => Promise<Page> = async () => ({ items: [], nextPageToken: "p2", pollingIntervalMillis: 5000 });

mock.module("../platforms/youtube", () => ({
  activeLiveChatId: async () => {
    calls.active += 1;
    return activeChat();
  },
  listChatMessages: async (_account: unknown, _chat: string, pageToken?: string) => {
    calls.list.push(pageToken);
    return listPage();
  },
}));

const { YouTubeChat } = await import("./youtube-chat");

const account = { id: "youtube:1", displayName: "Me", channelId: "UC1" };
const realError = console.error;
let statuses: { state: string; errorKey?: string }[] = [];
let chat: InstanceType<typeof YouTubeChat> | null = null;

function sink(): ChatSink {
  return {
    messages: () => undefined,
    remove: () => undefined,
    removeAuthor: () => undefined,
    clear: () => undefined,
    event: () => undefined,
    status: (status) => void statuses.push(status),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => {
  chat?.stop();
  chat = null;
  statuses = [];
  calls.active = 0;
  calls.list = [];
  console.error = realError;
  activeChat = async () => "chat-1";
  listPage = async () => ({ items: [], nextPageToken: "p2", pollingIntervalMillis: 5000 });
});

describe("YouTube chat", () => {
  test("a disconnected account is reported instead of staying on connecting", async () => {
    chat = new YouTubeChat(() => undefined, sink());
    chat.start();
    await settle();
    expect(statuses.at(-1)).toEqual({ state: "error", errorKey: "signedOut" });
    expect(calls.active).toBe(0);
  });

  test("quota errors are shown as quota and the saved page position is dropped", async () => {
    console.error = () => undefined;
    listPage = async () => {
      throw new Error("youtube-quota-exceeded");
    };
    chat = new YouTubeChat(() => account, sink());
    chat.start();
    await settle();
    expect(statuses.at(-1)).toEqual({ state: "error", errorKey: "quota" });
  });

  test("an ended chat waits for the next broadcast instead of failing", async () => {
    listPage = async () => {
      throw new Error("youtube-chat-ended");
    };
    chat = new YouTubeChat(() => account, sink());
    chat.start();
    await settle();
    expect(statuses.at(-1)).toEqual({ state: "waiting" });
  });

  test("no active broadcast waits without polling messages", async () => {
    activeChat = async () => null;
    chat = new YouTubeChat(() => account, sink());
    chat.start();
    await settle();
    expect(statuses.at(-1)).toEqual({ state: "waiting" });
    expect(calls.list).toEqual([]);
  });

  test("a reply that arrives after stop never changes the state", async () => {
    let release: (page: Page) => void = () => undefined;
    listPage = () => new Promise<Page>((resolve) => { release = resolve; });
    chat = new YouTubeChat(() => account, sink());
    chat.start();
    await settle();
    chat.stop();
    release({ items: [], nextPageToken: "late" });
    await settle();
    expect(statuses.at(-1)).toEqual({ state: "offline" });
  });
});
