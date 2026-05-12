import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name: string) => resolve(root, "node_modules/.bin", name);

if (!existsSync(resolve(root, "dist"))) {
  console.log("▶ no dist/ found — running initial build…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

const useTunnel = process.argv.includes("--https") || process.argv.includes("--ducky");
const VITE_PORT = 4310;

function tag(label: string, color: string) {
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  return (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (line.trim()) process.stdout.write(prefix + line + "\n");
    }
  };
}

const server = spawn(bin("tsx"), ["watch", "src/cli.ts", "--port", "4311"], {
  cwd: root,
  env: { ...process.env, RVC_DEV: "1" },
  stdio: ["inherit", "pipe", "pipe"],
});
server.stdout!.on("data", tag("server", "32"));
server.stderr!.on("data", tag("server", "32"));

const client = spawn(bin("vite"), ["dev"], {
  cwd: root,
  env: { ...process.env },
});
client.stdout.on("data", tag("client", "36"));
client.stderr.on("data", tag("client", "36"));

let duckyProc: ChildProcess | null = null;

if (useTunnel) {
  (async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const bold = "\x1b[1m";
    const yellow = "\x1b[33m";
    const reset = "\x1b[0m";
    const require = createRequire(import.meta.url);
    const duckyPkg = require.resolve("@ducky.wtf/cli/package.json");
    const duckyBin = resolve(dirname(duckyPkg), "dist/index.js");
    const proc = spawn(process.execPath, [duckyBin, "http", String(VITE_PORT)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    duckyProc = proc;
    let buffer = "";
    let announced = false;
    const urlRe = /https:\/\/[a-z0-9-]+\.ducky\.wtf/i;
    const onChunk = (chunk: Buffer) => {
      buffer += chunk.toString();
      if (!announced) {
        const m = buffer.match(urlRe);
        if (m) {
          announced = true;
          const url = m[0];
          console.log("");
          console.log(`${bold}[ducky]${reset} ${url}`);
          console.log(`${yellow}Scan with your phone:${reset}`);
          qrcode.generate(url, { small: true });
        }
      }
    };
    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);
    proc.on("exit", (code) => {
      if (!announced) {
        console.error(`[ducky] exited (code ${code}) before producing a URL`);
      }
    });
    proc.on("error", (err) => {
      console.error(`[ducky] failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  })();
}

for (const sig of ["SIGINT", "SIGTERM"] as NodeJS.Signals[]) {
  process.on(sig, () => {
    if (duckyProc && duckyProc.exitCode === null && !duckyProc.killed) {
      try {
        duckyProc.kill("SIGINT");
      } catch {}
    }
    client.kill(sig);
    server.kill(sig);
    process.exit(0);
  });
}
