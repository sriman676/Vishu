import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser → core is cross-origin; proxy /rpc and /events to the core so the app is same-origin (no
// CORS change to the core's security surface). Target is the running `vishu serve` (default :5712).
const target = process.env.VISHU_CORE_URL || "http://127.0.0.1:5712";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5800,
    proxy: {
      "/rpc": { target, changeOrigin: true },
      "/events": { target, changeOrigin: true }, // SSE passes through http-proxy
    },
  },
});
