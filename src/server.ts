import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Hono } from "hono";
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
  app.use(
    "/*",
    serveStatic({
      root: relative(process.cwd(), opts.staticDir) || ".",
      rewriteRequestPath: (path) => (path === "/" ? "/index.html" : path),
    })
  );
  app.notFound(async (c) => {
    // SPA fallback for client-side routes that don't match a real file.
    try {
      const indexHtml = await readFile(join(opts.staticDir, "index.html"));
      return c.html(indexHtml.toString(), 200, { "cache-control": "no-cache" });
    } catch {
      return c.text("not found", 404);
    }
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

function buildUrl(host: string, port: number, token: string | null): string {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const base = `http://${displayHost}:${port}/`;
  return token ? `${base}?token=${token}` : base;
}
