import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@ui": path.resolve(__dirname, "./src/ui"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
