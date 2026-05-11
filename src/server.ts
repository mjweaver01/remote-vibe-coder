import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createApiRoutes } from "./routes/api.ts";
import { SessionManager } from "./sessions.ts";
import { attachWebSocket } from "./ws.ts";

export interface ServerOptions {
  port: number;
  host: string;
  root: string;
  token: string | null;
  staticDir: string;
  command: string;
  idleTimeoutMs?: number;
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const sessions = new SessionManager({ command: opts.command, idleTimeoutMs: opts.idleTimeoutMs });

  const app = new Hono();
  app.route("/api", createApiRoutes({ root: opts.root, token: opts.token, port: opts.port }));
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
