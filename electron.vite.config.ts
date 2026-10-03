import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const RENDERER_ROOT = path.resolve(__dirname, "src/renderer");

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
  },
  renderer: {
    root: RENDERER_ROOT,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": RENDERER_ROOT },
    },
    build: {
      rollupOptions: { input: path.join(RENDERER_ROOT, "index.html") },
    },
  },
});
