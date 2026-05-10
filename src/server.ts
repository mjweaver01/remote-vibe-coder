import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { tokensMatch } from "./auth.ts";
import { gitDiff, listTree, readFileSafe } from "./code.ts";
import { gitStatus, gitStage, gitUnstage, gitCommit } from "./git.ts";
import { listFolders } from "./files.ts";
import { listPastSessions } from "./history.ts";
import { SessionManager, type ViewerSink } from "./sessions.ts";
import type { ClientMessage, ServerMessage } from "./types.ts";

export interface ServerOptions {
  port: number;
  host: string;
  root: string;
  token: string | null;
  staticDir: string;
  command: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const sessions = new SessionManager({ command: opts.command });

  const httpServer = createServer(async (req, res) => {
    try {
      await handleHttp(req, res, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Server error: ${msg}`);
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (!tokensMatch(opts.token, url.searchParams.get("token"))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attachWs(ws, sessions));
  });

  await new Promise<void>((resolveListen) => {
    httpServer.listen(opts.port, opts.host, () => resolveListen());
  });

  const url = buildUrl(opts.host, opts.port, opts.token);

  return {
    url,
    close: async () => {
      sessions.killAll();
      wss.clients.forEach((c) => c.terminate());
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}

function buildUrl(host: string, port: number, token: string | null): string {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const base = `http://${displayHost}:${port}/`;
  return token ? `${base}?token=${token}` : base;
}

async function handleHttp(req: IncomingMessage, res: ServerResponse, opts: ServerOptions) {
  const url = new URL(req.url ?? "/", "http://x");

  if (!tokensMatch(opts.token, url.searchParams.get("token"))) {
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("Unauthorized — append ?token=… to the URL");
    return;
  }

  if (url.pathname === "/api/folders") {
    const path = url.searchParams.get("path") || opts.root;
    try {
      const result = await listFolders(path, opts.root);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  if (url.pathname === "/api/tree") {
    const path = url.searchParams.get("path");
    if (!path) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing path" }));
      return;
    }
    try {
      const result = await listTree(path, opts.root);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  if (url.pathname === "/api/file") {
    const path = url.searchParams.get("path");
    if (!path) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing path" }));
      return;
    }
    try {
      const result = await readFileSafe(path, opts.root);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  if (url.pathname === "/api/diff") {
    const path = url.searchParams.get("path");
    if (!path) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing path" }));
      return;
    }
    try {
      const result = await gitDiff(path, opts.root);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  if (url.pathname === "/api/history") {
    const path = url.searchParams.get("path");
    if (!path) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing path" }));
      return;
    }
    try {
      const result = await listPastSessions(path);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ sessions: result }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  if (url.pathname === "/api/config") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ root: opts.root, hasToken: !!opts.token }));
    return;
  }

  if (url.pathname === "/api/git/status") {
    const path = url.searchParams.get("path");
    if (!path) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing path" }));
      return;
    }
    try {
      const result = await gitStatus(path, opts.root);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  if (url.pathname === "/api/git/stage" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { files } = JSON.parse(body) as { files: string[] };
      await gitStage(files, opts.root);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  if (url.pathname === "/api/git/unstage" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { files } = JSON.parse(body) as { files: string[] };
      await gitUnstage(files, opts.root);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  if (url.pathname === "/api/git/commit" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { cwd, message } = JSON.parse(body) as { cwd: string; message: string };
      const result = await gitCommit(cwd, message, opts.root);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  await serveStatic(url.pathname, opts.staticDir, res);
}

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy(new Error("payload too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveStatic(pathname: string, staticDir: string, res: ServerResponse) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  if (rel.includes("..")) {
    res.writeHead(400);
    res.end("bad path");
    return;
  }
  const file = join(staticDir, rel);
  if (!resolve(file).startsWith(resolve(staticDir))) {
    res.writeHead(400);
    res.end("bad path");
    return;
  }
  try {
    const s = await stat(file);
    if (s.isFile()) {
      const data = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(data);
      return;
    }
  } catch {
    // fall through to SPA fallback
  }
  // SPA fallback: serve index.html for client-side routes
  try {
    const indexHtml = await readFile(join(staticDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(indexHtml);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

function attachWs(ws: WebSocket, sessions: SessionManager) {
  const sink: ViewerSink = {
    send(msg: ServerMessage) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };

  const unsubscribe = sessions.subscribe(sink);

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sink.send({ type: "error", message: "invalid JSON" });
      ws.close(1008, "invalid message format");
      return;
    }
    handleClientMessage(msg, sink, sessions);
  });

  ws.on("close", () => {
    unsubscribe();
    sessions.detachEverywhere(sink);
  });
  ws.on("error", () => {
    unsubscribe();
    sessions.detachEverywhere(sink);
  });
}

function handleClientMessage(msg: ClientMessage, sink: ViewerSink, sessions: SessionManager) {
  switch (msg.type) {
    case "list":
      sink.send({ type: "sessions", sessions: sessions.list() });
      return;
    case "create": {
      const info = sessions.create(msg.cwd, msg.cols, msg.rows, msg.mode);
      sessions.attach(info.id, sink);
      sink.send({ type: "created", session: info });
      return;
    }
    case "join": {
      const info = sessions.attach(msg.sessionId, sink);
      if (!info) {
        sink.send({ type: "error", message: `session ${msg.sessionId} not found` });
        return;
      }
      sessions.resize(msg.sessionId, msg.cols, msg.rows);
      return;
    }
    case "detach":
      sessions.detach(msg.sessionId, sink);
      return;
    case "input":
      sessions.input(msg.sessionId, msg.data);
      return;
    case "resize":
      sessions.resize(msg.sessionId, msg.cols, msg.rows);
      return;
    case "kill":
      sessions.kill(msg.sessionId);
      return;
  }
}
