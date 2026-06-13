import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

const shared = resolve("src/shared");
const { version } = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": shared } },
    build: { externalizeDeps: { exclude: ["@google/genai", "fastest-levenshtein"] } },
  },
  preload: {
    resolve: { alias: { "@shared": shared } },
  },
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: {
      alias: {
        "@shared": shared,
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react()],
  },
});
