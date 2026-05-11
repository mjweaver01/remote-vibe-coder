import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { ensureSelfSignedCert } from "./src/certs.ts";

export const DEV_SERVER_PORT = 4310;
export const DEV_NODE_PORT = 4311;

// Reuse the same self-signed cert the Node server uses, so the browser
// trusts one origin and `https://localhost:4310` is a secure context
// (needed for getUserMedia and webkitSpeechRecognition on Safari).
const tls = process.env.RVC_HTTPS ? await ensureSelfSignedCert() : null;
const upstream = tls ? "https" : "http";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: DEV_SERVER_PORT,
    host: true,
    allowedHosts: true,
    ...(tls ? { https: { cert: tls.cert, key: tls.key } } : {}),
    proxy: {
      "/api": {
        target: `${upstream}://localhost:${DEV_NODE_PORT}`,
        changeOrigin: false,
        secure: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const host = req.headers.host;
            if (host) {
              proxyReq.setHeader("x-forwarded-host", host);
              const idx = host.lastIndexOf(":");
              if (idx !== -1) proxyReq.setHeader("x-forwarded-port", host.slice(idx + 1));
            }
            if (tls) proxyReq.setHeader("x-forwarded-proto", "https");
          });
        },
      },
      "/assets/monaco": {
        target: `${upstream}://localhost:${DEV_NODE_PORT}`,
        secure: false,
      },
      "/ws": {
        target: `${tls ? "wss" : "ws"}://localhost:${DEV_NODE_PORT}`,
        ws: true,
        secure: false,
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
