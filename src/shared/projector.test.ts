import { describe, expect, test } from "bun:test";
import { MULTIVIEW_SCENES, projectorCells, sanitizeProjectorTarget } from "./projector";

const scenes = ["Intro", "Game", "Chat", "Break", "Outro", "Camera", "Screen", "Guest", "Extra"];

describe("projector cells", () => {
  test("program and preview show one cell each", () => {
    const context = { studioMode: true, programScene: "Game", previewScene: "Chat", scenes };
    expect(projectorCells({ kind: "program" }, context)).toEqual([{ role: "program", name: "Game", live: true, previewing: false }]);
    expect(projectorCells({ kind: "preview" }, context)).toEqual([{ role: "preview", name: "Chat", live: false, previewing: true }]);
  });

  test("outside studio mode the preview shows the program", () => {
    const context = { studioMode: false, programScene: "Game", previewScene: null, scenes };
    expect(projectorCells({ kind: "preview" }, context)).toEqual([{ role: "preview", name: "Game", live: true, previewing: false }]);
  });

  test("multiview shows preview, program and at most eight scenes, marking live and previewed scenes", () => {
    const context = { studioMode: true, programScene: "Game", previewScene: "Chat", scenes };
    const cells = projectorCells({ kind: "multiview" }, context);
    expect(cells.length).toBe(2 + MULTIVIEW_SCENES);
    expect(cells.slice(0, 2).map((cell) => cell.role)).toEqual(["preview", "program"]);
    expect(cells.slice(2).map((cell) => cell.name)).toEqual(scenes.slice(0, MULTIVIEW_SCENES));
    expect(cells.find((cell) => cell.name === "Game" && cell.role === "scene")?.live).toBe(true);
    expect(cells.find((cell) => cell.name === "Chat" && cell.role === "scene")?.previewing).toBe(true);
    expect(cells.filter((cell) => cell.role === "scene" && (cell.live || cell.previewing)).length).toBe(2);
  });

  test("scene and source projectors show their target", () => {
    const context = { studioMode: false, programScene: "Game", previewScene: null, scenes };
    expect(projectorCells({ kind: "scene", name: "Game" }, context)).toEqual([{ role: "scene", name: "Game", live: true, previewing: false }]);
    expect(projectorCells({ kind: "source", name: "Camera" }, context)).toEqual([{ role: "source", name: "Camera", live: false, previewing: false }]);
  });
});

describe("projector targets from IPC", () => {
  test("accepts known targets only", () => {
    expect(sanitizeProjectorTarget({ kind: "program" })).toEqual({ kind: "program" });
    expect(sanitizeProjectorTarget({ kind: "multiview", name: "ignored" })).toEqual({ kind: "multiview" });
    expect(sanitizeProjectorTarget({ kind: "scene", name: "Game" })).toEqual({ kind: "scene", name: "Game" });
    expect(sanitizeProjectorTarget({ kind: "scene" })).toBeNull();
    expect(sanitizeProjectorTarget({ kind: "source", name: "x".repeat(300) })).toBeNull();
    expect(sanitizeProjectorTarget({ kind: "window" })).toBeNull();
    expect(sanitizeProjectorTarget("program")).toBeNull();
    expect(sanitizeProjectorTarget(null)).toBeNull();
  });
});
