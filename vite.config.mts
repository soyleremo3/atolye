import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src",
  base: "./",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "chrome140",
    chunkSizeWarningLimit: 4000,
    reportCompressedSize: false,
  },
});
