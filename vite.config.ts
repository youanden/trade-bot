import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [cloudflare(), react(), tailwindcss()],
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
});
