// Main-process client for the engine worker. Every call is asynchronous, so a
// slow or stuck engine operation can never freeze the app window.

import { EventEmitter } from "node:events";
import path from "node:path";
import { app, utilityProcess, type UtilityProcess } from "electron";
import { stopOrphanedHosts } from "./orphans";
import type { EngineEvent, EngineHandlers, EngineInit, WorkerMessage, WorkerRequest } from "./worker";

type Method = keyof EngineHandlers;
type Args<M extends Method> = Parameters<EngineHandlers[M]>;
type Result<M extends Method> = ReturnType<EngineHandlers[M]>;

const DEFAULT_TIMEOUT_MS = 20_000;
const INIT_TIMEOUT_MS = 60_000;
// Engine teardown alone takes a few seconds.
const SHUTDOWN_TIMEOUT_MS = 12_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class EngineClient extends EventEmitter {
  private child: UtilityProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private exiting = false;

  get running(): boolean {
    return this.child !== null;
  }

  async start(init: EngineInit): Promise<void> {
    this.exiting = false;
    const child = utilityProcess.fork(path.join(__dirname, "engine-worker.js"), [], {
      serviceName: "SEENALYZE STUDIO Engine",
      stdio: "pipe",
    });
    this.child = child;
    // Forward the worker's output; engine logs are only useful during development.
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    if (!app.isPackaged) child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.on("message", (message: WorkerMessage) => this.onMessage(message));
    child.on("exit", (code) => this.onExit(code));
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("exit", () => reject(new Error("engine-stopped")));
    });
    await this.callWithTimeout(INIT_TIMEOUT_MS, "init", init);
  }

  call<M extends Method>(method: M, ...args: Args<M>): Promise<Awaited<Result<M>>> {
    return this.callWithTimeout(DEFAULT_TIMEOUT_MS, method, ...args);
  }

  callWithTimeout<M extends Method>(timeoutMs: number, method: M, ...args: Args<M>): Promise<Awaited<Result<M>>> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new Error("engine-not-ready"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("engine-timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      const request: WorkerRequest = { id, method, args };
      this.child.postMessage(request);
    });
  }

  /** Graceful teardown with a hard deadline; the worker is killed if it does not finish. */
  async shutdown(): Promise<void> {
    if (!this.child) return;
    this.exiting = true;
    try {
      await this.callWithTimeout(SHUTDOWN_TIMEOUT_MS, "shutdown");
    } catch (error) {
      console.error("[engine] graceful shutdown did not finish", error);
    }
    const child = this.child;
    if (child) {
      const exited = new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(resolve, 2000);
      });
      child.kill();
      await exited;
    }
    this.child = null;
    // If teardown did not finish, the engine host outlives the worker; stop it.
    stopOrphanedHosts();
  }

  private onMessage(message: WorkerMessage): void {
    if (message.kind === "event") {
      this.emit("event", message.event satisfies EngineEvent);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.kind === "result") pending.resolve(message.value);
    else pending.reject(new Error(message.code));
  }

  private onExit(code: number): void {
    this.child = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("engine-stopped"));
      this.pending.delete(id);
    }
    if (!this.exiting) {
      console.error(`[engine] worker exited unexpectedly (code ${code})`);
      this.emit("crash");
    }
  }
}

