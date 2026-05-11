import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export const DEV_SERVER_PORT = 4310;
export const DEV_NODE_PORT = 4311;

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: DEV_SERVER_PORT,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": `http://localhost:${DEV_NODE_PORT}`,
      "/assets/monaco": `http://localhost:${DEV_NODE_PORT}`,
      "/ws": {
        target: `ws://localhost:${DEV_NODE_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: "../dist/web",
    assetsDir: "assets",
    sourcemap: false,
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
