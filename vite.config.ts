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
      "/api": {
        target: `http://localhost:${DEV_NODE_PORT}`,
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const host = req.headers.host;
            if (host) {
              proxyReq.setHeader("x-forwarded-host", host);
              const idx = host.lastIndexOf(":");
              if (idx !== -1) proxyReq.setHeader("x-forwarded-port", host.slice(idx + 1));
            }
          });
        },
      },
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
