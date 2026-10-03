import type { StreamEvent } from "../../shared/overlays";
import type { ChatConnectionState, ChatMessage } from "../../shared/types";

/** Where a chat source reports what it receives. */
export interface ChatSink {
  messages(messages: ChatMessage[]): void;
  remove(ids: string[]): void;
  removeAuthor(authorId: string): void;
  clear(): void;
  /** Follows, subs, cheers, Super Chats… derived from the chat feed. */
  event(event: StreamEvent): void;
  status(status: { state: ChatConnectionState; errorKey?: string }): void;
}

export interface ChatSource {
  start(): void;
  stop(): void;
}
