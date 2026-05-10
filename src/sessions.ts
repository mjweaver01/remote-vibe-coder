import { spawn, type IPty } from 'node-pty';
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import type { CreateMode, ServerMessage, SessionInfo } from './types.ts';

const RING_BUFFER_BYTES = 64 * 1024;

export interface ViewerSink {
  send(msg: ServerMessage): void;
}

interface Session {
  id: string;
  cwd: string;
  cwdLabel: string;
  createdAt: number;
  cols: number;
  rows: number;
  pty: IPty;
  ringBuffer: string;
  viewers: Set<ViewerSink>;
  ended: boolean;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private listeners = new Set<ViewerSink>();
  private command: string;

  constructor(opts: { command: string }) {
    this.command = opts.command;
  }

  /** Subscribe to session-list updates. Returns an unsubscribe fn. */
  subscribe(sink: ViewerSink): () => void {
    this.listeners.add(sink);
    sink.send({ type: 'sessions', sessions: this.list() });
    return () => this.listeners.delete(sink);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map(this.toInfo.bind(this));
  }

  private toInfo(s: Session): SessionInfo {
    return {
      id: s.id,
      cwd: s.cwd,
      cwdLabel: s.cwdLabel,
      createdAt: s.createdAt,
      cols: s.cols,
      rows: s.rows,
      viewers: s.viewers.size,
    };
  }

  private broadcastSessions() {
    const msg: ServerMessage = { type: 'sessions', sessions: this.list() };
    for (const l of this.listeners) l.send(msg);
  }

  create(cwd: string, cols: number, rows: number, mode: CreateMode = { kind: 'new' }): SessionInfo {
    const id = randomBytes(4).toString('hex');
    const cwdLabel = labelFor(cwd);
    const args =
      mode.kind === 'continue'
        ? ['--continue']
        : mode.kind === 'resume'
        ? ['--resume', mode.conversationId]
        : [];
    const ptyProc = spawn(this.command, args, {
      name: 'xterm-256color',
      cols: Math.max(20, cols | 0),
      rows: Math.max(5, rows | 0),
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    const session: Session = {
      id,
      cwd,
      cwdLabel,
      createdAt: Date.now(),
      cols: cols | 0,
      rows: rows | 0,
      pty: ptyProc,
      ringBuffer: '',
      viewers: new Set(),
      ended: false,
    };

    ptyProc.onData((data) => {
      session.ringBuffer = appendRing(session.ringBuffer, data);
      const msg: ServerMessage = { type: 'output', sessionId: id, data };
      for (const v of session.viewers) v.send(msg);
    });

    ptyProc.onExit(({ exitCode }) => {
      session.ended = true;
      const msg: ServerMessage = { type: 'ended', sessionId: id, exitCode: exitCode ?? 0 };
      for (const v of session.viewers) v.send(msg);
      this.sessions.delete(id);
      this.broadcastSessions();
    });

    this.sessions.set(id, session);
    this.broadcastSessions();
    return this.toInfo(session);
  }

  attach(sessionId: string, viewer: ViewerSink): SessionInfo | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    s.viewers.add(viewer);
    viewer.send({ type: 'attached', sessionId, replay: s.ringBuffer });
    this.broadcastSessions();
    return this.toInfo(s);
  }

  detach(sessionId: string, viewer: ViewerSink) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.viewers.delete(viewer)) {
      this.broadcastSessions();
    }
  }

  detachEverywhere(viewer: ViewerSink) {
    for (const s of this.sessions.values()) {
      if (s.viewers.delete(viewer)) this.broadcastSessions();
    }
  }

  input(sessionId: string, data: string) {
    const s = this.sessions.get(sessionId);
    if (s && !s.ended) s.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number) {
    const s = this.sessions.get(sessionId);
    if (!s || s.ended) return;
    const c = Math.max(20, cols | 0);
    const r = Math.max(5, rows | 0);
    if (s.cols === c && s.rows === r) return;
    s.cols = c;
    s.rows = r;
    try {
      s.pty.resize(c, r);
    } catch {
      // PTY may have just died
    }
    this.broadcastSessions();
  }

  kill(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try {
      s.pty.kill();
    } catch {
      // already dead
    }
  }

  killAll() {
    for (const s of this.sessions.values()) {
      try {
        s.pty.kill();
      } catch {
        // already dead
      }
    }
  }
}

function labelFor(cwd: string): string {
  return basename(cwd) || cwd;
}

function appendRing(buf: string, chunk: string): string {
  const next = buf + chunk;
  if (Buffer.byteLength(next, 'utf8') <= RING_BUFFER_BYTES) return next;
  // Trim from the front by characters; close enough for our purposes
  const overshoot = Buffer.byteLength(next, 'utf8') - RING_BUFFER_BYTES;
  return next.slice(overshoot);
}
