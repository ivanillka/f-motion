import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Demo/e2e harness listens on 43140; durable stack uses :3000 via VITE_API_PROXY.
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:43140" }
  }
});
