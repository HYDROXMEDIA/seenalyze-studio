import { create } from "zustand";
import type { ChatEvent, ChatMessage, ChatSourceStatus, ChatState } from "../../shared/types";

const LIMIT = 300;
const OPEN_KEY = "seenalyze-studio-chat-open";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "false";
  } catch (error) {
    console.warn("[chat] storage unavailable", error);
    return true;
  }
}

interface ChatStore {
  open: boolean;
  messages: ChatMessage[];
  sources: ChatSourceStatus[];
  setOpen: (open: boolean) => void;
  load: (state: ChatState) => void;
  apply: (event: ChatEvent) => void;
}

export const useChat = create<ChatStore>((set) => ({
  open: readOpen(),
  messages: [],
  sources: [],
  setOpen: (open) => {
    try {
      window.localStorage.setItem(OPEN_KEY, String(open));
    } catch (error) {
      console.warn("[chat] storage unavailable", error);
    }
    set({ open });
  },
  load: (state) => set({ messages: state.messages.slice(-LIMIT), sources: state.sources }),
  apply: (event) =>
    set((state) => {
      switch (event.type) {
        case "messages":
          return { messages: [...state.messages, ...event.messages].slice(-LIMIT) };
        case "remove": {
          const removed = new Set(event.ids);
          return { messages: state.messages.filter((message) => !removed.has(message.id)) };
        }
        case "removeAuthor":
          return {
            messages: state.messages.filter((message) => !(message.platform === event.platform && message.authorId === event.authorId)),
          };
        case "clear":
          return { messages: state.messages.filter((message) => message.accountId !== event.accountId) };
        case "sources":
          return { sources: event.sources };
      }
    }),
}));
