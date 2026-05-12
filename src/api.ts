import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { networkInterfaces } from "node:os";
import type { IncomingMessage } from "node:http";
import QRCode from "qrcode";
import { tokensMatch } from "./auth.ts";
import { gitDiff, listTree, readFileSafe } from "./code.ts";
import { gitStatus, gitStage, gitUnstage, gitCommit } from "./git.ts";
import { listFolders } from "./files.ts";
import { listPastSessions } from "./history.ts";
import type { PushService } from "./push.ts";
import type { PushSubscription as WebPushSubscription } from "web-push";

export interface ApiContext {
  root: string;
  token: string | null;
  port: number;
  publicUrl?: string | null;
  push?: PushService;
}

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

function nodeReq(env: unknown): IncomingMessage {
  return (env as { incoming: IncomingMessage }).incoming;
}

export function createApiRoutes(ctx: ApiContext): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const provided = c.req.query("token") ?? readTokenCookie(c.req.header("cookie") ?? "");
    if (!tokensMatch(ctx.token, provided)) {
      return c.text("Unauthorized — append ?token=… to the URL", 401);
    }
    return next();
  });

  app.get("/folders", async (c) => {
    const path = c.req.query("path") || ctx.root;
    try {
      return c.json(await listFolders(path, ctx.root));
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.get("/tree", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "missing path" }, 400);
    try {
      return c.json(await listTree(path, ctx.root));
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.get("/file", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "missing path" }, 400);
    try {
      return c.json(await readFileSafe(path, ctx.root));
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.get("/diff", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "missing path" }, 400);
    try {
      return c.json(await gitDiff(path, ctx.root));
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.get("/history", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "missing path" }, 400);
    try {
      return c.json({ sessions: await listPastSessions(path) });
    } catch (err) {
      return c.json({ error: errMessage(err) }, 500);
    }
  });

  app.get("/config", (c) => c.json({ root: ctx.root, hasToken: !!ctx.token }));

  app.get("/pairing-url", (c) => c.json({ url: buildPairingUrl(nodeReq(c.env), ctx) }));

  app.get("/qr", async (c) => {
    try {
      const svg = await QRCode.toString(buildPairingUrl(nodeReq(c.env), ctx), {
        type: "svg",
        margin: 1,
        width: 280,
      });
      return new Response(svg, {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
    } catch (err) {
      return c.json({ error: errMessage(err) }, 500);
    }
  });

  app.get("/git/status", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "missing path" }, 400);
    try {
      return c.json(await gitStatus(path, ctx.root));
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.use("/git/*", bodyLimit({ maxSize: MAX_BODY_BYTES }));

  app.post("/git/stage", async (c) => {
    try {
      const { files } = await c.req.json<{ files: string[] }>();
      await gitStage(files, ctx.root);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.post("/git/unstage", async (c) => {
    try {
      const { files } = await c.req.json<{ files: string[] }>();
      await gitUnstage(files, ctx.root);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.post("/git/commit", async (c) => {
    try {
      const { cwd, message } = await c.req.json<{ cwd: string; message: string }>();
      return c.json(await gitCommit(cwd, message, ctx.root));
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.get("/push/vapid-public-key", (c) => {
    if (!ctx.push) return c.json({ error: "push not available" }, 503);
    try {
      return c.json({ publicKey: ctx.push.getPublicKey() });
    } catch (err) {
      return c.json({ error: errMessage(err) }, 500);
    }
  });

  app.post("/push/subscribe", async (c) => {
    if (!ctx.push) return c.json({ error: "push not available" }, 503);
    try {
      const { subscription, ua } = await c.req.json<{
        subscription: WebPushSubscription;
        ua?: string;
      }>();
      if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
        return c.json({ error: "invalid subscription" }, 400);
      }
      await ctx.push.subscribe(subscription, ua);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.post("/push/unsubscribe", async (c) => {
    if (!ctx.push) return c.json({ error: "push not available" }, 503);
    try {
      const { endpoint } = await c.req.json<{ endpoint: string }>();
      if (!endpoint) return c.json({ error: "missing endpoint" }, 400);
      await ctx.push.unsubscribe(endpoint);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: errMessage(err) }, 400);
    }
  });

  app.all("*", (c) => c.json({ error: "not found" }, 404));

  return app;
}

function readTokenCookie(cookieHeader: string): string | null {
  const match = cookieHeader.match(/(?:^|;\s*)rvc_token=([^;]+)/);
  return match?.[1] ?? null;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildPairingUrl(req: IncomingMessage, ctx: ApiContext): string {
  if (ctx.publicUrl) {
    const url = new URL(ctx.publicUrl);
    if (ctx.token) url.searchParams.set("token", ctx.token);
    return url.toString();
  }
  const forwardedHost = firstHeader(req.headers["x-forwarded-host"]);
  const forwardedPort = firstHeader(req.headers["x-forwarded-port"]);
  const requestHost = forwardedHost ?? req.headers.host ?? `localhost:${ctx.port}`;
  const [hostname, hostPort] = splitHostPort(requestHost);
  const isLoopbackHost = isLoopback(hostname);
  const reachableHost = isLoopbackHost ? (firstLanIp() ?? hostname) : hostname;
  const proto =
    firstHeader(req.headers["x-forwarded-proto"]) ??
    ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  // Only append a port if one was provided (forwarded or in the Host header),
  // or we swapped a loopback host for a LAN IP — otherwise the request came in
  // on a standard port (80/443 via an HTTPS tunnel or a reverse proxy) and
  // we'd produce a broken URL like https://foo.ducky.wtf:4311/.
  const portStr = forwardedPort ?? hostPort ?? (isLoopbackHost ? String(ctx.port) : null);
  const url = new URL(`${proto}://${reachableHost}${portStr ? `:${portStr}` : ""}/`);
  if (ctx.token) url.searchParams.set("token", ctx.token);
  return url.toString();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value?.split(",")[0]?.trim() || undefined;
}

function splitHostPort(hostHeader: string): [string, string | null] {
  if (hostHeader.startsWith("[")) {
    const close = hostHeader.indexOf("]");
    if (close === -1) return [hostHeader, null];
    const host = hostHeader.slice(0, close + 1);
    const rest = hostHeader.slice(close + 1);
    return [host, rest.startsWith(":") ? rest.slice(1) : null];
  }
  const idx = hostHeader.lastIndexOf(":");
  if (idx === -1) return [hostHeader, null];
  return [hostHeader.slice(0, idx), hostHeader.slice(idx + 1)];
}

function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  );
}

function firstLanIp(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}
