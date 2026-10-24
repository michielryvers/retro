import { defineConfig } from "vite";
import { foldkit } from "@foldkit/vite-plugin";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [foldkit()],
  optimizeDeps: {
    include: [
      "effect",
      "effect/Function",
      "effect/http",
      "@effect/platform-browser",
    ],
  },
  server: { hmr: false, host: "127.0.0.1", port: 5187 },
  build: { target: "es2022" },
});
