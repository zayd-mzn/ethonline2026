import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // GitHub Pages serves the project site from /<repo>/. Overridable via BASE_PATH
  // (e.g. set to "/" for a custom domain or user/organization page).
  base: process.env.BASE_PATH ?? "/ethonline2026/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // backend (Member 2)
      "/marketplace": "http://localhost:3001",
      "/api":         "http://localhost:3001",
      "/health":      "http://localhost:3001",
      "/agent-info":  "http://localhost:3001",
      "/agents":      "http://localhost:3001",
      "/world":       "http://localhost:3001",
      // agent event stream (Member 3) — SSE needs changeOrigin
      "/events":   { target: "http://localhost:3002", changeOrigin: true },
      "/activity": { target: "http://localhost:3002", changeOrigin: true },
    },
  },
});
