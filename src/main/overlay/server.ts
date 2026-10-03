// Local overlay server. Serves on-stream overlay pages to the engine's
// built-in browser. Bound to 127.0.0.1 so nothing outside this computer can
// reach it; it only exposes chat that is already public on the platforms.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { settingsToCss, resolveValues, type OverlayDefinition, type OverlayPreset } from "../../shared/overlays";
import type { ChatEvent, ChatState } from "../../shared/types";
import { chatOverlayPage } from "./chat-page";
import type { OverlayFeedMessage } from "./data";
import { buildOverlayDocument, OVERLAY_CSP } from "./document";

export const DEFAULT_OVERLAY_PORT = 47821;
const PORT_ATTEMPTS = 10;
const KEEPALIVE_MS = 15_000;

export interface OverlayChatFeed {
  state(): ChatState;
  subscribe(listener: (event: ChatEvent) => void): () => void;
}

/** Library overlays and their live data; optional so the chat page works on its own. */
export interface OverlayLibraryFeed {
  get(id: string): OverlayDefinition | undefined;
  preset?(id: string): OverlayPreset | undefined;
  subscribe(listener: (message: OverlayFeedMessage) => void): () => void;
}

type SettingsPush = { type: "settings"; values: Record<string, unknown>; css: string } | { type: "reload" };

export class OverlayServer {
  private server: Server | null = null;
  private port = 0;
  /** Open overlay pages per overlay id, for live settings updates from the editor. */
  private readonly pages = new Map<string, Set<(message: SettingsPush) => void>>();

  constructor(
    private readonly chat: OverlayChatFeed,
    private readonly overlays?: OverlayLibraryFeed,
  ) {}

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  presetUrl(id: string): string {
    return `${this.origin}/overlay/p/${encodeURIComponent(id)}`;
  }

  overlayUrl(id: string, preview = false): string {
    return `${this.origin}/overlay/o/${encodeURIComponent(id)}${preview ? "?preview=1" : ""}`;
  }

  /** Pushes new settings to every open copy of an overlay (stream and editor preview). */
  pushSettings(overlay: OverlayDefinition): void {
    const message: SettingsPush = {
      type: "settings",
      values: resolveValues(overlay.fields, overlay.values),
      css: settingsToCss(overlay.fields, overlay.values),
    };
    for (const send of this.pages.get(overlay.id) ?? []) send(message);
  }

  /** Makes open copies reload, e.g. after the design itself changed. */
  reloadOverlay(id: string): void {
    for (const send of this.pages.get(id) ?? []) send({ type: "reload" });
  }

  get running(): boolean {
    return this.server !== null;
  }

  get chatUrl(): string {
    return `http://127.0.0.1:${this.port}/overlay/chat`;
  }

  /** Listens on the preferred port (so saved overlay sources keep working), falling back to nearby ports. */
  async start(preferredPort = DEFAULT_OVERLAY_PORT): Promise<number> {
    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
      try {
        this.port = await this.listen(preferredPort + attempt);
        return this.port;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    }
    this.port = await this.listen(0);
    return this.port;
  }

  stop(): void {
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = null;
  }

  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => this.route(request, response));
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        this.server = server;
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  private route(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    if (url.pathname === "/overlay/chat" || url.pathname === "/overlay/chat/") {
      response
        .writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https://static-cdn.jtvnw.net https://*.ggpht.com https://*.googleusercontent.com; connect-src 'self'",
        })
        .end(chatOverlayPage());
      return;
    }
    if (url.pathname === "/overlay/events" || url.pathname === "/overlay/chat/events") {
      this.streamChat(request, response);
      return;
    }
    const preset = /^\/overlay\/p\/([a-z0-9-]{1,60})\/?$/u.exec(url.pathname);
    const presetDefinition = preset && this.overlays?.preset ? this.overlays.preset(preset[1]) : undefined;
    if (presetDefinition) {
      // Gallery previews: defaults plus demo data, no live feed.
      response
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": OVERLAY_CSP })
        .end(buildOverlayDocument({ html: presetDefinition.html, fields: presetDefinition.fields, values: {} }, true, null));
      return;
    }
    const match = /^\/overlay\/o\/([a-f0-9-]{36})(\/events)?\/?$/u.exec(url.pathname);
    const overlay = match && this.overlays ? this.overlays.get(match[1]) : undefined;
    if (match && overlay) {
      const preview = url.searchParams.get("preview") === "1";
      if (match[2]) this.streamOverlay(overlay.id, preview, request, response);
      else
        response
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": OVERLAY_CSP })
          .end(buildOverlayDocument(overlay, preview, `/overlay/o/${overlay.id}/events${preview ? "?preview=1" : ""}`));
      return;
    }
    response.writeHead(404).end();
  }

  /** Server-sent events: current messages first, then live updates. */
  private streamChat(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    const send = (payload: unknown) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ type: "state", messages: this.chat.state().messages });
    const unsubscribe = this.chat.subscribe((event) => {
      if (event.type !== "sources") send(event);
    });
    const keepalive = setInterval(() => response.write(": keepalive\n\n"), KEEPALIVE_MS);
    request.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  }

  /**
   * Live feed for one overlay page. The editor preview (sandboxed frame with an
   * opaque origin) needs CORS; the data is public chat and channel numbers.
   * Previews get settings only: their runtime generates demo data instead.
   */
  private streamOverlay(id: string, preview: boolean, request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    const send = (payload: unknown) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
    // Flush headers now so clients connect even before the first update.
    response.write(": connected\n\n");
    let pages = this.pages.get(id);
    if (!pages) {
      pages = new Set();
      this.pages.set(id, pages);
    }
    pages.add(send);
    const unsubscribe = preview || !this.overlays ? () => undefined : this.overlays.subscribe(send);
    const keepalive = setInterval(() => response.write(": keepalive\n\n"), KEEPALIVE_MS);
    request.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
      pages?.delete(send);
      if (pages?.size === 0) this.pages.delete(id);
    });
  }
}
