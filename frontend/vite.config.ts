import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const api = env.VITE_API_BASE ?? "http://localhost:3001";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: api, changeOrigin: true },
        "/ws": { target: api, ws: true, changeOrigin: true },
      },
    },
  };
});
