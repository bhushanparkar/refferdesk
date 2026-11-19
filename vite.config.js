import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, API calls go to the backend on :3000
const target = "http://localhost:3000";
const paths = ["/auth", "/jobs", "/my", "/requests", "/skills"];

export default defineConfig({
  plugins: [react()],
  server: { proxy: Object.fromEntries(paths.map((p) => [p, target])) },
});
