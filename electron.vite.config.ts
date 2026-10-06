import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const RENDERER_ROOT = path.resolve(__dirname, "src/renderer");
// Screen recording runs in its own small windows next to the studio.
const RECORDING_PAGES = ["capture", "recorder", "facecam", "controls", "editor"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "src/main/index.ts"),
          // Runs in a utility process so engine calls never block the window.
          "engine-worker": path.resolve(__dirname, "src/main/engine/worker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "src/preload/index.ts"),
          ...Object.fromEntries(RECORDING_PAGES.map((page) => [`recording-${page}`, path.resolve(__dirname, `src/preload/recording-${page}.ts`)])),
        },
      },
    },
  },
  renderer: {
    root: RENDERER_ROOT,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": RENDERER_ROOT },
    },
    build: {
      rollupOptions: {
        input: {
          index: path.join(RENDERER_ROOT, "index.html"),
          ...Object.fromEntries(RECORDING_PAGES.map((page) => [`recording-${page}`, path.join(RENDERER_ROOT, "screen-recording", page, "index.html")])),
        },
      },
    },
  },
});
