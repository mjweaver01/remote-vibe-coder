// Build script — invoked via `tsx src/build.ts`. Uses esbuild for speed.
// Produces:
//   dist/cli.js                  — Node ESM server bundle
//   dist/web/index.html          — single-page shell
//   dist/web/styles.css          — global styles
//   dist/web/assets/app.js       — React app bundle
//   dist/web/assets/xterm.css    — xterm.js base styles
//   dist/web/assets/monaco/vs/*  — monaco-editor AMD distribution

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const distDir = join(root, 'dist');
const distWeb = join(distDir, 'web');
const distAssets = join(distWeb, 'assets');

function clean() {
  if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distAssets, { recursive: true });
}

async function buildServer() {
  await build({
    entryPoints: [join(root, 'src/cli.ts')],
    outfile: join(distDir, 'cli.js'),
    platform: 'node',
    target: 'node20',
    format: 'esm',
    bundle: true,
    sourcemap: true,
    logLevel: 'warning',
    external: ['node-pty', 'qrcode-terminal', 'ws'],
    banner: { js: '#!/usr/bin/env node' },
  });
  chmodSync(join(distDir, 'cli.js'), 0o755);
}

async function buildClient() {
  await build({
    entryPoints: [join(root, 'web/src/main.tsx')],
    outfile: join(distAssets, 'app.js'),
    platform: 'browser',
    target: ['es2022'],
    format: 'esm',
    bundle: true,
    minify: true,
    sourcemap: true,
    jsx: 'automatic',
    logLevel: 'warning',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    loader: {
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
  });
  // xterm base CSS, served alongside the bundle
  const xtermCss = readFileSync(
    join(root, 'node_modules/@xterm/xterm/css/xterm.css'),
    'utf8',
  );
  writeFileSync(join(distAssets, 'xterm.css'), xtermCss);
}

function copyStatic() {
  cpSync(join(root, 'web/index.html'), join(distWeb, 'index.html'));
  cpSync(join(root, 'web/styles.css'), join(distWeb, 'styles.css'));
}

function copyMonaco() {
  const src = join(root, 'node_modules/monaco-editor/min/vs');
  const dst = join(distAssets, 'monaco/vs');
  if (!existsSync(src)) {
    console.warn('  ! monaco-editor not installed; skipping');
    return;
  }
  cpSync(src, dst, { recursive: true });
}

async function main() {
  console.log('▶ cleaning dist/');
  clean();
  console.log('▶ bundling server (esbuild → Node ESM)…');
  await buildServer();
  console.log('▶ bundling client (React + esbuild)…');
  await buildClient();
  console.log('▶ copying static assets…');
  copyStatic();
  console.log('▶ copying monaco-editor…');
  copyMonaco();
  console.log('✓ build complete → dist/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
