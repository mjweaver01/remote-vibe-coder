import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name: string) => resolve(root, "node_modules/.bin", name);

// Ensure dist/ exists so the Node server's locateStaticDir() can find app.js.
if (!existsSync(resolve(root, "dist"))) {
  console.log("▶ no dist/ found — running initial build…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

function tag(label: string, color: string) {
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  return (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (line.trim()) process.stdout.write(prefix + line + "\n");
    }
  };
}

// Node server on an internal port — Vite dev server proxies /api and /ws to it.
const server = spawn(bin("tsx"), ["watch", "src/cli.ts", "--port", "4311"], {
  cwd: root,
  env: { ...process.env, RVC_DEV: "1" },
  stdio: ["inherit", "pipe", "pipe"],
});
server.stdout!.on("data", tag("server", "32"));
server.stderr!.on("data", tag("server", "32"));

// Vite dev server — real HMR, proxies to Node server above.
const client = spawn(bin("vite"), ["dev"], { cwd: root });
client.stdout.on("data", tag("client", "36"));
client.stderr.on("data", tag("client", "36"));

for (const sig of ["SIGINT", "SIGTERM"] as NodeJS.Signals[]) {
  process.on(sig, () => {
    client.kill(sig);
    server.kill(sig);
    process.exit(0);
  });
}
