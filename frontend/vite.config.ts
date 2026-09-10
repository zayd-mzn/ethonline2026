import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // @worldcoin/idkit's package.json "main"/"types" point at raw src/index.ts
      // (not a valid browser entry), which crashes on import. Alias to its
      // prebuilt ESM bundle instead.
      "@worldcoin/idkit": fileURLToPath(
        new URL("./node_modules/@worldcoin/idkit/build/index.js", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // backend (Member 2)
      "/marketplace": "http://localhost:3001",
      "/api":         "http://localhost:3001",
      "/health":      "http://localhost:3001",
      "/agent-info":  "http://localhost:3001",
      "/agents":      "http://localhost:3001",
      // agent event stream (Member 3) — SSE needs changeOrigin
      "/events":   { target: "http://localhost:3002", changeOrigin: true },
      "/activity": { target: "http://localhost:3002", changeOrigin: true },
    },
  },
});
