import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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
  tunnel: boolean;
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
    tunnel: false,
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
          console.error(
            `error: invalid port "${portStr}" — must be an integer between 1 and 65535`
          );
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
      case "--https":
      case "--ducky":
        flags.tunnel = true;
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

  if (
    !tokenFlagSeen &&
    (flags.tunnel || (flags.host !== "127.0.0.1" && flags.host !== "localhost"))
  ) {
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
-t, --token <str>          Require ?token=… (auto-generated when --https/--ducky or non-loopback host)
    --no-token             Skip token (insecure)
-c, --command <bin>        Command to run in each session (default: claude)
    --idle-timeout <m>     Kill sessions idle for more than <m> minutes
    --https, --ducky       Expose via a public HTTPS tunnel (ducky.wtf, anonymous)
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
  const candidates = [resolve(here, "web"), resolve(here, "../dist/web"), resolve(here, "../web")];
  for (const c of candidates) {
    if (existsSync(join(c, "assets", "app.js"))) return c;
  }
  throw new Error(
    `could not locate built web assets — run "npm run build" first.\nLooked in:\n  - ${candidates.join("\n  - ")}`
  );
}

interface TunnelHandle {
  url: string;
  close(): Promise<void>;
}

function resolveDuckyBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("@ducky.wtf/cli/package.json");
  return resolve(dirname(pkgPath), "dist/index.js");
}

function startDuckyTunnel(port: number): Promise<TunnelHandle> {
  return new Promise((resolveTunnel, rejectTunnel) => {
    const bin = resolveDuckyBin();
    const proc: ChildProcess = spawn(process.execPath, [bin, "http", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let settled = false;
    let buffer = "";
    const urlRe = /https:\/\/[a-z0-9-]+\.ducky\.wtf/i;

    const onChunk = (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString();
      const m = buffer.match(urlRe);
      if (m) {
        settled = true;
        resolveTunnel({
          url: m[0],
          close: () =>
            new Promise<void>((done) => {
              if (proc.exitCode !== null || proc.killed) return done();
              proc.once("exit", () => done());
              proc.kill("SIGINT");
              setTimeout(() => {
                if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
              }, 2000);
            }),
        });
      }
    };

    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      rejectTunnel(err);
    });

    proc.on("exit", (code) => {
      if (settled) return;
      settled = true;
      rejectTunnel(
        new Error(
          `ducky exited (code ${code}) before producing a tunnel URL. ` +
            `Output was:\n${buffer.trim() || "(empty)"}`
        )
      );
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGINT");
      } catch {}
      rejectTunnel(new Error("timed out waiting for ducky to print a tunnel URL"));
    }, 30000);
  });
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

  const probe = spawnSync(flags.command, ["--version"], { stdio: "ignore" });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === "ENOENT") {
    console.error(
      `error: "${flags.command}" was not found on PATH.\n` +
        `       remote-vibe-coder wraps the Claude Code CLI — install it first:\n` +
        `         npm install -g @anthropic-ai/claude-code\n` +
        `       Or pass --command <bin> to point at a different executable.`
    );
    process.exit(1);
  }

  // node-pty's posix_spawnp doesn't always resolve PATH the same way Node's
  // child_process does (notably for binaries in ~/.local/bin under some shells),
  // so resolve the command to an absolute path once here and hand that to PTY.
  if (!flags.command.includes("/")) {
    const which = spawnSync("which", [flags.command], { encoding: "utf8" });
    const resolved = which.stdout?.trim();
    if (resolved && existsSync(resolved)) {
      flags.command = resolved;
    }
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
    idleTimeoutMs: flags.idleTimeoutMs ?? undefined,
    publicUrl: null,
  });

  let tunnel: TunnelHandle | null = null;
  let publicUrl: string | null = null;
  if (flags.tunnel) {
    try {
      tunnel = await startDuckyTunnel(flags.port);
      publicUrl = tunnel.url;
    } catch (err) {
      console.error(
        `error: failed to start ducky tunnel: ${err instanceof Error ? err.message : String(err)}`
      );
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
    console.log(`${bold}${cyan}remote-vibe-coder${reset} — Claude Code, anywhere`);
    console.log(`${dim}api${reset}  http://${flags.host}:${flags.port}`);
    return;
  }

  console.log("");
  console.log(`${bold}${cyan}remote-vibe-coder${reset} — Claude Code, anywhere`);
  console.log(`${dim}root:${reset}  ${flags.root}`);
  console.log(`${dim}host:${reset}  ${flags.host}:${flags.port}`);
  if (publicUrl) {
    console.log(`${dim}https:${reset} ${publicUrl}`);
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
    if (tunnel) {
      try {
        await tunnel.close();
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
