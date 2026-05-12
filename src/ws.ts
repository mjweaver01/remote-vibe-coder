import type { ServerType } from "@hono/node-server";
import { WebSocketServer, type WebSocket } from "ws";
import { tokensMatch } from "./auth.ts";
import type { SessionManager, ViewerSink } from "./sessions.ts";
import type { ClientMessage, ServerMessage } from "./types.ts";

export interface WsAttachment {
  close: () => void;
}

// If a viewer has more than this much output queued in ws.bufferedAmount, it
// is too far behind to catch up — close it. The client will reconnect via
// WsClient backoff and replay from the session ring buffer.
const MAX_WS_BUFFER_BYTES = 1 * 1024 * 1024;

export function attachWebSocket(
  server: ServerType,
  sessions: SessionManager,
  token: string | null
): WsAttachment {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (!tokensMatch(token, url.searchParams.get("token"))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attachViewer(ws, sessions));
  });

  return {
    close: () => wss.clients.forEach((c) => c.terminate()),
  };
}

function attachViewer(ws: WebSocket, sessions: SessionManager) {
  const sink: ViewerSink = {
    send(msg: ServerMessage) {
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > MAX_WS_BUFFER_BYTES) {
        // Slow viewer: drop them so memory doesn't grow unbounded. The client
        // will reconnect and replay from the ring buffer.
        ws.close(1013, "viewer too slow");
        return;
      }
      ws.send(JSON.stringify(msg));
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
    void dispatch(msg, sink, sessions).catch((err) => {
      sink.send({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    });
  });

  const teardown = () => {
    unsubscribe();
    sessions.detachEverywhere(sink);
  };
  ws.on("close", teardown);
  ws.on("error", teardown);
}

async function dispatch(msg: ClientMessage, sink: ViewerSink, sessions: SessionManager) {
  switch (msg.type) {
    case "list":
      sink.send({ type: "sessions", sessions: sessions.list() });
      return;
    case "create": {
      const info = await sessions.create(msg.cwd, msg.cols, msg.rows, msg.mode);
      sessions.attach(info.id, sink, msg.cols, msg.rows);
      sink.send({ type: "created", session: info });
      return;
    }
    case "join": {
      const info = sessions.attach(msg.sessionId, sink, msg.cols, msg.rows);
      if (!info) {
        sink.send({ type: "error", message: `session ${msg.sessionId} not found` });
        return;
      }
      return;
    }
    case "detach":
      sessions.detach(msg.sessionId, sink);
      return;
    case "input":
      sessions.input(msg.sessionId, msg.data);
      return;
    case "resize":
      sessions.resize(msg.sessionId, sink, msg.cols, msg.rows);
      return;
    case "kill":
      sessions.kill(msg.sessionId);
      return;
  }
}
