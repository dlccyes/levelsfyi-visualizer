import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/levels": {
        target: "https://api.levels.fyi",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/levels/, ""),
      },
    },
  },
});
