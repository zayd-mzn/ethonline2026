import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // backend (Member 2)
      "/marketplace": "http://localhost:3001",
      "/api":         "http://localhost:3001",
      "/health":      "http://localhost:3001",
      // agent event stream (Member 3) — SSE needs changeOrigin
      "/events":   { target: "http://localhost:3002", changeOrigin: true },
      "/activity": { target: "http://localhost:3002", changeOrigin: true },
    },
  },
});
