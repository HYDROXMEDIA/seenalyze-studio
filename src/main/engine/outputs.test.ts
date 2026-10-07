import { describe, expect, test } from "bun:test";
import type { DestinationConfig, DestinationStatus } from "../../shared/types";
import type { EngineSession } from "./engine";
import { OutputManager, type LiveDestination } from "./outputs";

function target(id: string): LiveDestination {
  const config: DestinationConfig = {
    id, platform: "twitch", name: id, enabled: true, mode: "manual", server: "", hasStreamKey: true,
    profile: { width: 640, height: 360, fps: 30, videoBitrateKbps: 1000, audioBitrateKbps: 160, keyframeSec: 2, codec: "h264" },
  };
  return { config, server: "rtmp://127.0.0.1/live", streamKey: "test-only" };
}

function fixture(failAt: "setup" | "start") {
  const released: object[] = [];
  const destroyed: object[] = [];
  let count = 0;
  const encoder = { release: () => released.push(encoder) };
  const streams: object[] = [];
  const engine = {
    settings: { fps: 30, outputWidth: 640, outputHeight: 360 }, video: {},
    osn: {
      AudioTrackFactory: { create: () => ({}), setAtIndex: () => undefined },
      VideoEncoderFactory: { create: () => encoder },
      AdvancedStreamingFactory: {
        create: () => {
          const first = count++ === 0;
          const stream = {
            videoEncoder: encoder,
            signalHandler: (_signal: { signal: string; code: number }) => undefined,
            start: () => {
              if (first && failAt === "start") throw new Error("test-start-failure");
              expect(released).toHaveLength(0);
              stream.signalHandler({ signal: "start", code: 0 });
            },
            stop: () => stream.signalHandler({ signal: "stop", code: 0 }),
          };
          streams.push(stream);
          return stream;
        },
        destroy: (stream: object) => destroyed.push(stream),
      },
      ServiceFactory: { create: () => {
        if (count === 1 && failAt === "setup") throw new Error("test-setup-failure");
        return {};
      } },
      DelayFactory: { create: () => ({}) }, ReconnectFactory: { create: () => ({}) }, NetworkFactory: { create: () => ({}) },
    },
  } as unknown as EngineSession;
  const manager = new OutputManager(engine);
  const statuses: DestinationStatus[] = [];
  manager.on("status", (status: DestinationStatus) => statuses.push(status));
  return { manager, released, destroyed, statuses, streams };
}

describe("destination failure isolation", () => {
  for (const failure of ["setup", "start"] as const) {
    test(`cleans up a ${failure} failure and preserves the shared encoder for the next destination`, () => {
      const { manager, released, destroyed, statuses, streams } = fixture(failure);
      manager.start([target("first"), target("second")], "x264");
      expect(destroyed).toContain(streams[0]);
      expect(manager.statuses().map(({ id, state }) => ({ id, state }))).toEqual([{ id: "second", state: "live" }]);
      expect(statuses.some((status) => status.id === "first" && status.state === "error")).toBe(true);
      expect(released).toHaveLength(0);
      manager.stop(["second"]);
      expect(manager.isStreaming).toBe(false);
      expect(released).toHaveLength(1);
      expect(destroyed).toHaveLength(2);
    });
  }
});
