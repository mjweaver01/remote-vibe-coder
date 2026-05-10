// Build script — invoked via `tsx src/build.ts`.
// Produces:
//   dist/cli.js                  — Node ESM server bundle (esbuild)
//   dist/web/**                  — React SPA + static assets (Vite)
//   dist/web/assets/monaco/vs/*  — monaco-editor AMD distribution

import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { build as viteBuild } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distDir = join(root, "dist");
const distAssets = join(distDir, "web", "assets");

function clean() {
  if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distAssets, { recursive: true });
}

async function buildServer() {
  await build({
    entryPoints: [join(root, "src/cli.ts")],
    outfile: join(distDir, "cli.js"),
    platform: "node",
    target: "node20",
    format: "esm",
    bundle: true,
    sourcemap: true,
    logLevel: "warning",
    external: ["node-pty", "qrcode-terminal", "ws"],
    banner: { js: "#!/usr/bin/env node" },
  });
  chmodSync(join(distDir, "cli.js"), 0o755);
}

async function buildClient() {
  await viteBuild();
}

function copyMonaco() {
  const src = join(root, "node_modules/monaco-editor/min/vs");
  const dst = join(distAssets, "monaco/vs");
  if (!existsSync(src)) {
    console.warn("  ! monaco-editor not installed; skipping");
    return;
  }
  cpSync(src, dst, { recursive: true });
}

async function main() {
  console.log("▶ cleaning dist/");
  clean();
  console.log("▶ bundling server (esbuild → Node ESM)…");
  await buildServer();
  console.log("▶ bundling client (React + Vite)…");
  await buildClient();
  console.log("▶ copying monaco-editor…");
  copyMonaco();
  console.log("✓ build complete → dist/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
