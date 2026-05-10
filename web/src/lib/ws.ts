// WebSocket client. Auto-reconnects with exponential backoff, exposes a small
// pub/sub API for components, and tracks the live session list pushed by the
// server.

import type {
  ClientMessage,
  ServerMessage,
  SessionInfo,
} from '../../../src/types.ts';
import { wsUrl } from './auth.ts';

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

type Listener<T> = (value: T) => void;
type MessageListener = Listener<ServerMessage>;

const MIN_RETRY_MS = 500;
const MAX_RETRY_MS = 8_000;

export class WsClient {
  private socket: WebSocket | null = null;
  private status: WsStatus = 'closed';
  private retryDelay = MIN_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private statusListeners = new Set<Listener<WsStatus>>();
  private messageListeners = new Set<MessageListener>();
  private sessionsListeners = new Set<Listener<SessionInfo[]>>();
  private latestSessions: SessionInfo[] = [];

  start() {
    if (this.destroyed) return;
    this.connect();
  }

  destroy() {
    this.destroyed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.setStatus('closed');
  }

  send(msg: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  /** Subscribe to all server messages. Returns unsubscribe. */
  onMessage(fn: MessageListener): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  /** Subscribe to status changes. Returns unsubscribe. */
  onStatus(fn: Listener<WsStatus>): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  /** Subscribe to session-list updates. Returns unsubscribe. */
  onSessions(fn: Listener<SessionInfo[]>): () => void {
    this.sessionsListeners.add(fn);
    fn(this.latestSessions);
    return () => this.sessionsListeners.delete(fn);
  }

  getStatus(): WsStatus {
    return this.status;
  }

  getSessions(): SessionInfo[] {
    return this.latestSessions;
  }

  private connect() {
    if (this.destroyed) return;
    this.setStatus(this.socket ? 'reconnecting' : 'connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl('/ws'));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.retryDelay = MIN_RETRY_MS;
      this.setStatus('open');
    });

    socket.addEventListener('message', (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'sessions') {
        this.latestSessions = msg.sessions;
        for (const fn of this.sessionsListeners) fn(msg.sessions);
      }
      for (const fn of this.messageListeners) fn(msg);
    });

    const closeOrError = () => {
      if (this.socket === socket) this.socket = null;
      this.scheduleReconnect();
    };
    socket.addEventListener('close', closeOrError);
    socket.addEventListener('error', closeOrError);
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.setStatus('reconnecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
      this.connect();
    }, this.retryDelay);
  }

  private setStatus(s: WsStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }
}

// Singleton instance for the whole app
let singleton: WsClient | null = null;

export function getWsClient(): WsClient {
  if (!singleton) {
    singleton = new WsClient();
    singleton.start();
  }
  return singleton;
}
