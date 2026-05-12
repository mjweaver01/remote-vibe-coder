import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApiRoutes } from "./api.ts";
import { SessionManager } from "./sessions.ts";
import { PushService } from "./push.ts";
import { attachWebSocket } from "./ws.ts";

export interface ServerOptions {
  port: number;
  host: string;
  root: string;
  token: string | null;
  staticDir: string;
  command: string;
  idleTimeoutMs?: number;
  publicUrl?: string | null;
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const push = new PushService();
  // Initialize lazily — failure to set up keys must not block the server.
  push.init().catch((err) => {
    console.error("push: init failed", err);
  });

  const sessions = new SessionManager({
    command: opts.command,
    idleTimeoutMs: opts.idleTimeoutMs,
    notifier: {
      onPrompt: ({ sessionId, cwdLabel, title, preview }) => {
        if (process.env.RVC_DEBUG)
          console.log(
            `[push] onPrompt id=${sessionId} subscribers=${push.hasSubscribers() ? "yes" : "no"}`
          );
        if (!push.hasSubscribers()) return;
        void push.send({
          title: title ? `${cwdLabel}: ${title}` : `${cwdLabel} — Claude needs input`,
          body: preview,
          url: `/s/${sessionId}`,
          sessionId,
          tag: `rvc-prompt-${sessionId}`,
        });
      },
    },
  });

  const app = new Hono();
  app.route(
    "/api",
    createApiRoutes({
      root: opts.root,
      token: opts.token,
      port: opts.port,
      publicUrl: opts.publicUrl ?? null,
      push,
    })
  );
  // Serve the PWA manifest dynamically so the token (if present on the request)
  // gets baked into start_url. iOS Safari installs a PWA into a separate WebKit
  // storage partition — without the token in start_url, the launched app can't
  // authenticate to /api/* or /ws.
  app.get("/manifest.webmanifest", async (c) => {
    const token = c.req.query("token");
    const startUrl = token ? `/?token=${encodeURIComponent(token)}` : "/";
    const manifest = {
      name: "Remote Vibe Coder",
      short_name: "Vibe Coder",
      description: "Run Claude Code remotely from any device.",
      start_url: startUrl,
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#0a0a0a",
      theme_color: "#0a0a0a",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      ],
    };
    return c.json(manifest, 200, {
      "content-type": "application/manifest+json",
      "cache-control": "no-cache",
    });
  });

  // Serve index.html ourselves so we can inject the token into the manifest
  // link href. iOS Safari pre-fetches the manifest when it parses the link tag,
  // so client-side rewriting is too late — it has to be in the HTML the server
  // returns.
  app.get("/", async (c) => {
    return serveIndexWithToken(c, opts.staticDir);
  });
  app.get("/index.html", async (c) => {
    return serveIndexWithToken(c, opts.staticDir);
  });

  app.use(
    "/*",
    serveStatic({
      root: relative(process.cwd(), opts.staticDir) || ".",
    })
  );
  app.notFound(async (c) => {
    // SPA fallback for client-side routes that don't match a real file.
    return serveIndexWithToken(c, opts.staticDir);
  });

  const server = serve({ fetch: app.fetch, port: opts.port, hostname: opts.host });
  const ws = attachWebSocket(server, sessions, opts.token);

  await new Promise<void>((ready) => server.once("listening", () => ready()));

  return {
    url: buildUrl(opts.host, opts.port, opts.token),
    close: async () => {
      sessions.close();
      sessions.killAll();
      ws.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

async function serveIndexWithToken(c: Context, staticDir: string): Promise<Response> {
  try {
    let html = (await readFile(join(staticDir, "index.html"))).toString();
    const token = c.req.query("token");
    if (token) {
      const encoded = encodeURIComponent(token);
      html = html.replace(
        /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/>/,
        `<link rel="manifest" href="/manifest.webmanifest?token=${encoded}" />`
      );
    }
    return c.html(html, 200, { "cache-control": "no-cache" });
  } catch {
    return c.text("not found", 404);
  }
}

function buildUrl(host: string, port: number, token: string | null): string {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const base = `http://${displayHost}:${port}/`;
  return token ? `${base}?token=${token}` : base;
}
