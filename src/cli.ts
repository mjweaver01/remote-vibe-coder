import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import qrcode from "qrcode-terminal";
import { startServer } from "./server.ts";
import { generateToken } from "./auth.ts";
import { expandHome } from "./files.ts";

interface Flags {
  port: number;
  host: string;
  root: string;
  token: string | null;
  command: string;
  help: boolean;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    port: 4310,
    host: "127.0.0.1",
    root: expandHome("~/Websites"),
    token: null,
    command: "claude",
    help: false,
  };
  let tokenFlagSeen = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (forFlag: string): string => {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`Missing value for ${forFlag}`);
        process.exit(2);
      }
      return v;
    };
    switch (a) {
      case "--port":
      case "-p":
        flags.port = Number(next(a));
        break;
      case "--host":
      case "-H":
        flags.host = next(a);
        break;
      case "--root":
      case "-r":
        flags.root = resolve(expandHome(next(a)));
        break;
      case "--token":
      case "-t":
        flags.token = next(a);
        tokenFlagSeen = true;
        break;
      case "--no-token":
        flags.token = null;
        tokenFlagSeen = true;
        break;
      case "--command":
      case "-c":
        flags.command = next(a);
        break;
      case "--help":
      case "-h":
        flags.help = true;
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`Unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }

  // Auto-token when bound to a non-loopback host and the user didn't say otherwise
  if (!tokenFlagSeen && flags.host !== "127.0.0.1" && flags.host !== "localhost") {
    flags.token = generateToken();
  }

  return flags;
}

function printHelp() {
  console.log(`remote-vibe-coder — Run Claude Code from your phone

Usage: remote-vibe-coder [options]

Options:
  -p, --port <n>         Port to listen on (default: 4310)
  -H, --host <addr>      Bind address (default: 127.0.0.1; use 0.0.0.0 for LAN)
  -r, --root <path>      Folder you can browse (default: ~/Websites)
  -t, --token <str>      Require ?token=… (auto-generated when --host is non-loopback)
      --no-token         Skip token (insecure on LAN)
  -c, --command <bin>    Command to run in each session (default: claude)
  -h, --help             Show this help
`);
}

function lanAddresses(): string[] {
  const out: string[] = [];
  const ifs = networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}

function locateStaticDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Prefer bundled output — it has the compiled app.js and xterm.css
  const candidates = [
    resolve(here, "web"), // prod: dist/cli.js → dist/web/
    resolve(here, "../dist/web"), // dev (tsx src/cli.ts): ../dist/web/
    resolve(here, "../web"), // raw source (only HTML/CSS will work)
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "assets", "app.js"))) return c;
  }
  throw new Error(
    `could not locate built web assets — run "bun run build" first.\nLooked in:\n  - ${candidates.join("\n  - ")}`
  );
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  if (!existsSync(flags.root)) {
    console.error(`error: --root directory does not exist: ${flags.root}`);
    process.exit(1);
  }
  if (!statSync(flags.root).isDirectory()) {
    console.error(`error: --root is not a directory: ${flags.root}`);
    process.exit(1);
  }

  const staticDir = locateStaticDir();

  const server = await startServer({
    port: flags.port,
    host: flags.host,
    root: flags.root,
    token: flags.token,
    staticDir,
    command: flags.command,
  });

  const reset = "\x1b[0m";
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const cyan = "\x1b[36m";
  const yellow = "\x1b[33m";

  console.log("");
  console.log(`${bold}${cyan}remote-vibe-coder${reset} — Claude Code, anywhere on your network`);
  console.log(`${dim}root:${reset}  ${flags.root}`);
  console.log(`${dim}host:${reset}  ${flags.host}:${flags.port}`);
  console.log("");

  const urls: string[] = [];
  if (flags.host === "0.0.0.0") {
    for (const addr of lanAddresses()) {
      const u = `http://${addr}:${flags.port}/${flags.token ? `?token=${flags.token}` : ""}`;
      urls.push(u);
    }
    if (urls.length === 0) urls.push(server.url);
  } else {
    urls.push(server.url);
  }

  for (const u of urls) {
    console.log(`  ${bold}→${reset} ${u}`);
  }
  console.log("");

  if (flags.token) {
    console.log(`${dim}token:${reset} ${flags.token}`);
    console.log("");
  }

  // QR code for the first URL — handy for phones
  if (flags.host === "0.0.0.0" && urls.length > 0) {
    console.log(`${yellow}Scan with your phone:${reset}`);
    qrcode.generate(urls[0]!, { small: true });
  }

  if (flags.host !== "0.0.0.0" && flags.host !== "localhost" && flags.host !== "127.0.0.1") {
    // Custom host (e.g. tailscale ip) — QR is still useful
    console.log(`${yellow}Scan with your phone:${reset}`);
    qrcode.generate(server.url, { small: true });
  }

  console.log(`${dim}press Ctrl+C to quit${reset}`);

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${dim}received ${sig}, shutting down…${reset}`);
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
