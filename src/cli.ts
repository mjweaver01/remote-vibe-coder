import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, networkInterfaces, platform } from "node:os";
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
  idleTimeoutMs: number | null;
  domain: string | null;
  ngrok: boolean;
  ngrokAuthtoken: string | null;
  ngrokDomain: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    port: 4310,
    host: "127.0.0.1",
    root: expandHome("~/Websites"),
    token: null,
    command: "claude",
    idleTimeoutMs: null,
    domain: null,
    ngrok: false,
    ngrokAuthtoken: null,
    ngrokDomain: null,
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
      case "-p": {
        const portStr = next(a);
        const port = Number(portStr);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          console.error(`error: invalid port "${portStr}" — must be an integer between 1 and 65535`);
          process.exit(2);
        }
        flags.port = port;
        break;
      }
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
      case "--idle-timeout": {
        const mins = Number(next(a));
        if (!Number.isFinite(mins) || mins <= 0) {
          console.error(`error: --idle-timeout must be a positive number of minutes`);
          process.exit(2);
        }
        flags.idleTimeoutMs = mins * 60 * 1000;
        break;
      }
      case "--domain":
        flags.domain = next(a);
        break;
      case "--ngrok":
        flags.ngrok = true;
        break;
      case "--ngrok-authtoken":
        flags.ngrokAuthtoken = next(a);
        flags.ngrok = true;
        break;
      case "--ngrok-domain":
        flags.ngrokDomain = next(a);
        flags.ngrok = true;
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

  if (!tokenFlagSeen && (flags.ngrok || (flags.host !== "127.0.0.1" && flags.host !== "localhost"))) {
    flags.token = generateToken();
  }

  return flags;
}

function printHelp() {
  console.log(`remote-vibe-coder — Run Claude Code from your phone

Usage: remote-vibe-coder [options]

Options:
  -p, --port <n>             Port to listen on (default: 4310)
  -H, --host <addr>          Bind address (default: 127.0.0.1; use 0.0.0.0 for LAN)
  -r, --root <path>          Folder you can browse (default: ~/Websites)
  -t, --token <str>          Require ?token=… (auto-generated when --ngrok or non-loopback host)
      --no-token             Skip token (insecure)
  -c, --command <bin>        Command to run in each session (default: claude)
      --idle-timeout <m>     Kill sessions idle for more than <m> minutes
      --ngrok                Expose via ngrok tunnel (HTTPS). Auth via NGROK_AUTHTOKEN env or flag.
      --ngrok-authtoken <t>  ngrok authtoken (overrides NGROK_AUTHTOKEN env). Implies --ngrok.
      --ngrok-domain <d>     Reserved ngrok domain (e.g. foo.ngrok-free.app). Implies --ngrok.
  -h, --help                 Show this help
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
  const candidates = [
    resolve(here, "web"),
    resolve(here, "../dist/web"),
    resolve(here, "../web"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "assets", "app.js"))) return c;
  }
  throw new Error(
    `could not locate built web assets — run "npm run build" first.\nLooked in:\n  - ${candidates.join("\n  - ")}`
  );
}

interface NgrokListener {
  url(): string;
  close(): Promise<void>;
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
      // Matches `authtoken: <token>` at top level OR nested under `agent:`.
      const m = text.match(/^[ \t]*authtoken:[ \t]*["']?([^\s"'#]+)/m);
      if (m && m[1]) return m[1];
    } catch {
      // ignore unreadable file
    }
  }
  return null;
}

function resolveNgrokAuthtoken(flags: Flags): string | null {
  return flags.ngrokAuthtoken ?? process.env.NGROK_AUTHTOKEN ?? readNgrokAuthtokenFromConfig();
}

async function startNgrok(port: number, authtoken: string, flags: Flags): Promise<NgrokListener> {
  const modName = "@ngrok/ngrok";
  const mod = await import(modName);
  const ngrok = (mod as { default?: unknown }).default ?? mod;
  const forward = (ngrok as { forward: (opts: Record<string, unknown>) => Promise<NgrokListener> }).forward;
  const opts: Record<string, unknown> = { addr: port, authtoken };
  if (flags.ngrokDomain) opts.domain = flags.ngrokDomain;
  return forward(opts);
}

async function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if ((major ?? 0) < 25) {
    console.error(
      `error: Node.js ${process.versions.node} is not supported — remote-vibe-coder requires Node 25 or later.\n` +
        `       https://nodejs.org/en/download`
    );
    process.exit(1);
  }

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

  let ngrokListener: NgrokListener | null = null;
  let publicUrl: string | null = null;
  let ngrokAuthtoken: string | null = null;
  if (flags.ngrok) {
    ngrokAuthtoken = resolveNgrokAuthtoken(flags);
    if (!ngrokAuthtoken) {
      console.error(
        "error: --ngrok requires an authtoken. Provide one of:\n" +
          "         --ngrok-authtoken <token>\n" +
          "         NGROK_AUTHTOKEN env var\n" +
          "         `ngrok config add-authtoken <token>` (persisted to ngrok.yml)\n" +
          "       Get one at https://dashboard.ngrok.com/get-started/your-authtoken"
      );
      process.exit(2);
    }
  }

  const server = await startServer({
    port: flags.port,
    host: flags.host,
    root: flags.root,
    token: flags.token,
    staticDir,
    command: flags.command,
    idleTimeoutMs: flags.idleTimeoutMs ?? undefined,
    publicUrl: null,
  });

  if (flags.ngrok && ngrokAuthtoken) {
    try {
      ngrokListener = await startNgrok(flags.port, ngrokAuthtoken, flags);
      publicUrl = ngrokListener.url();
    } catch (err) {
      console.error(`error: failed to start ngrok tunnel: ${err instanceof Error ? err.message : String(err)}`);
      await server.close();
      process.exit(1);
    }
  }

  const reset = "\x1b[0m";
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const cyan = "\x1b[36m";
  const yellow = "\x1b[33m";

  if (process.env.RVC_DEV) {
    console.log(`${bold}${cyan}remote-vibe-coder${reset} — Claude Code, anywhere on your network`);
    console.log(`${dim}api${reset}  http://${flags.host}:${flags.port}`);
    return;
  }

  console.log("");
  console.log(`${bold}${cyan}remote-vibe-coder${reset} — Claude Code, anywhere on your network`);
  console.log(`${dim}root:${reset}  ${flags.root}`);
  console.log(`${dim}host:${reset}  ${flags.host}:${flags.port}`);
  if (publicUrl) {
    console.log(`${dim}ngrok:${reset} ${publicUrl}`);
  }
  console.log("");

  const tokenSuffix = flags.token ? `?token=${flags.token}` : "";
  const urls: string[] = [];
  if (publicUrl) {
    urls.push(`${publicUrl.replace(/\/$/, "")}/${tokenSuffix}`);
  } else if (flags.domain) {
    const base = flags.domain.replace(/\/$/, "");
    urls.push(`${base}/${tokenSuffix}`);
  } else if (flags.host === "0.0.0.0") {
    for (const addr of lanAddresses()) {
      urls.push(`http://${addr}:${flags.port}/${tokenSuffix}`);
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

  const qrUrl = urls[0];
  if (qrUrl) {
    console.log(`${yellow}Scan with your phone:${reset}`);
    qrcode.generate(qrUrl, { small: true });
  }

  console.log(`${dim}press Ctrl+C to quit${reset}`);

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${dim}received ${sig}, shutting down…${reset}`);
    if (ngrokListener) {
      try {
        await ngrokListener.close();
      } catch {}
    }
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
