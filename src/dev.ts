import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name: string) => resolve(root, "node_modules/.bin", name);

if (!existsSync(resolve(root, "dist"))) {
  console.log("▶ no dist/ found — running initial build…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

const useNgrok = process.argv.includes("--ngrok");
const VITE_PORT = 4310;

function tag(label: string, color: string) {
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  return (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (line.trim()) process.stdout.write(prefix + line + "\n");
    }
  };
}

function ngrokConfigCandidates(): string[] {
  const home = homedir();
  const out: string[] = [];
  if (platform() === "darwin") {
    out.push(join(home, "Library", "Application Support", "ngrok", "ngrok.yml"));
  }
  if (platform() === "win32" && process.env.LOCALAPPDATA) {
    out.push(join(process.env.LOCALAPPDATA, "ngrok", "ngrok.yml"));
  }
  out.push(join(home, ".config", "ngrok", "ngrok.yml"));
  out.push(join(home, ".ngrok2", "ngrok.yml"));
  return out;
}

function readNgrokAuthtokenFromConfig(): string | null {
  for (const path of ngrokConfigCandidates()) {
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, "utf8");
      const m = text.match(/^[ \t]*authtoken:[ \t]*["']?([^\s"'#]+)/m);
      if (m && m[1]) return m[1];
    } catch {}
  }
  return null;
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

let ngrokListener: { close: () => Promise<void> } | null = null;

if (useNgrok) {
  const authtoken = process.env.NGROK_AUTHTOKEN ?? readNgrokAuthtokenFromConfig();
  if (!authtoken) {
    console.error(
      "\n[ngrok] no authtoken found. Run `ngrok config add-authtoken <token>` or set NGROK_AUTHTOKEN.\n"
    );
  } else {
    (async () => {
      // wait briefly so Vite is listening before we forward to it
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const modName = "@ngrok/ngrok";
        const mod = await import(modName);
        const ngrok = (mod as { default?: unknown }).default ?? mod;
        const forward = (
          ngrok as {
            forward: (
              opts: Record<string, unknown>
            ) => Promise<{ url(): string; close(): Promise<void> }>;
          }
        ).forward;
        const listener = await forward({ addr: VITE_PORT, authtoken });
        ngrokListener = listener;
        const url = listener.url();
        const bold = "\x1b[1m";
        const yellow = "\x1b[33m";
        const reset = "\x1b[0m";
        console.log("");
        console.log(`${bold}[ngrok]${reset} ${url}`);
        console.log(`${yellow}Scan with your phone:${reset}`);
        qrcode.generate(url, { small: true });
      } catch (err) {
        console.error(`[ngrok] failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as NodeJS.Signals[]) {
  process.on(sig, async () => {
    if (ngrokListener) {
      try {
        await ngrokListener.close();
      } catch {}
    }
    client.kill(sig);
    server.kill(sig);
    process.exit(0);
  });
}
