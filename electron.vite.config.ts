import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

const shared = resolve("src/shared");

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": shared } },
  },
  preload: {
    resolve: { alias: { "@shared": shared } },
  },
  renderer: {
    resolve: {
      alias: {
        "@shared": shared,
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react()],
  },
});
