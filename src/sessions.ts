import { spawn, type IPty } from "node-pty";
import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  listConversationFiles,
  mostRecentConversationId,
  projectsDirFor,
  readFirstUserMessage,
} from "./claudeProjects.ts";
import { detectPrompt } from "./prompts.ts";
import type { CreateMode, ServerMessage, SessionInfo } from "./types.ts";

/** Optional sink for "Claude appears to be waiting for input" events. */
export interface PromptNotifier {
  onPrompt(info: { sessionId: string; cwdLabel: string; title?: string; preview: string }): void;
}

const PROMPT_IDLE_MS = 1500;
const PROMPT_COOLDOWN_MS = 60_000;
const PROMPT_TAIL_BYTES = 4096;

export const RING_BUFFER_BYTES = 64 * 1024;
const RING_SLACK_BYTES = RING_BUFFER_BYTES / 2;

export interface ViewerSink {
  send(msg: ServerMessage): void;
}

export interface ViewerDims {
  cols: number;
  rows: number;
}

interface Session {
  id: string;
  cwd: string;
  cwdLabel: string;
  createdAt: number;
  lastActivityAt: number;
  cols: number;
  rows: number;
  pty: IPty;
  ringBuffer: Buffer;
  viewers: Map<ViewerSink, ViewerDims>;
  ended: boolean;
  /** Conversation log files that existed before this session spawned (for "new" mode attribution). */
  preexistingConvFiles: Set<string>;
  conversationId?: string;
  title?: string;
  promptIdleTimer: ReturnType<typeof setTimeout> | null;
  lastPromptNotifyAt: number;
  /** Last-observed conversation JSONL size that matched our PTY's view. */
  knownConvLogSize: number;
  /** Time when our PTY last emitted data — used to attribute log growth. */
  lastPtyDataAt: number;
  /** Pending settle timer that records the JSONL size after PTY output flushes. */
  convSizeSettleTimer: ReturnType<typeof setTimeout> | null;
  externallyUpdated: boolean;
}

const TITLE_REFRESH_MS = 3000;

export class SessionManager {
  private sessions = new Map<string, Session>();
  private listeners = new Set<ViewerSink>();
  private command: string;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private titleTimer: ReturnType<typeof setInterval> | null = null;
  private notifier: PromptNotifier | null = null;

  constructor(opts: { command: string; idleTimeoutMs?: number; notifier?: PromptNotifier }) {
    this.command = opts.command;
    this.notifier = opts.notifier ?? null;
    if (opts.idleTimeoutMs) {
      const timeoutMs = opts.idleTimeoutMs;
      this.idleTimer = setInterval(() => {
        const now = Date.now();
        for (const s of this.sessions.values()) {
          if (!s.ended && now - s.lastActivityAt > timeoutMs) {
            try {
              s.pty.kill();
            } catch {
              // already dead
            }
          }
        }
      }, 60_000);
    }
    this.titleTimer = setInterval(() => {
      void this.refreshTitles();
    }, TITLE_REFRESH_MS);
  }

  close() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.titleTimer) {
      clearInterval(this.titleTimer);
      this.titleTimer = null;
    }
    for (const s of this.sessions.values()) {
      if (s.promptIdleTimer) {
        clearTimeout(s.promptIdleTimer);
        s.promptIdleTimer = null;
      }
      if (s.convSizeSettleTimer) {
        clearTimeout(s.convSizeSettleTimer);
        s.convSizeSettleTimer = null;
      }
    }
  }

  setNotifier(notifier: PromptNotifier | null) {
    this.notifier = notifier;
  }

  private scheduleIdlePromptCheck(s: Session) {
    if (!this.notifier) return;
    if (s.promptIdleTimer) clearTimeout(s.promptIdleTimer);
    s.promptIdleTimer = setTimeout(() => {
      s.promptIdleTimer = null;
      if (s.ended) return;
      const now = Date.now();
      if (now - s.lastPromptNotifyAt < PROMPT_COOLDOWN_MS) return;
      const tail = s.ringBuffer.subarray(Math.max(0, s.ringBuffer.length - PROMPT_TAIL_BYTES));
      const result = detectPrompt(tail.toString("utf8"));
      if (!result.matched) return;
      s.lastPromptNotifyAt = now;
      this.notifier?.onPrompt({
        sessionId: s.id,
        cwdLabel: s.cwdLabel,
        title: s.title,
        preview: result.preview ?? "Claude is waiting for input",
      });
    }, PROMPT_IDLE_MS);
  }

  /** Resolve conversationId + title for any session missing them, and check for
   *  external writes to the conversation log. Broadcasts on change. */
  private async refreshTitles() {
    let changed = false;
    for (const s of this.sessions.values()) {
      if (!s.conversationId) {
        const files = await listConversationFiles(s.cwd);
        const fresh = files.find((f) => !s.preexistingConvFiles.has(f));
        if (fresh) {
          s.conversationId = fresh.replace(/\.jsonl$/, "");
        }
      }
      if (!s.conversationId) continue;
      if (!s.title) {
        const title = await readFirstUserMessage(s.cwd, s.conversationId);
        if (title) {
          s.title = title;
          changed = true;
        }
      }
      if (await this.checkExternalGrowth(s)) changed = true;
    }
    if (changed) this.broadcastSessions();
  }

  /**
   * Compare the conversation JSONL size on disk vs the size we recorded after
   * our PTY last emitted output. Growth that arrives while our PTY has been
   * quiet for QUIET_MS is treated as an external `claude` process appending to
   * the same conversation — the user's terminal here can't show those changes
   * without a restart.
   */
  private async checkExternalGrowth(s: Session): Promise<boolean> {
    if (!s.conversationId) return false;
    const QUIET_MS = 2500;
    const size = await readConvLogSize(s.cwd, s.conversationId);
    if (s.knownConvLogSize === 0) {
      s.knownConvLogSize = size;
      return false;
    }
    // If our PTY just emitted output, growth is almost certainly our own; the
    // settle-timer will update knownConvLogSize shortly. Skip this round.
    if (Date.now() - s.lastPtyDataAt < QUIET_MS) return false;
    if (size <= s.knownConvLogSize) {
      // The log shrunk or rotated — treat as a fresh baseline.
      if (size !== s.knownConvLogSize) s.knownConvLogSize = size;
      return false;
    }
    if (!s.externallyUpdated) {
      s.externallyUpdated = true;
      return true;
    }
    return false;
  }

  /**
   * Debounce a JSONL-size snapshot after PTY output stops, so growth that
   * actually came from this PTY doesn't get attributed to an external writer.
   */
  private scheduleConvSizeSnapshot(s: Session) {
    if (!s.conversationId) return;
    if (s.convSizeSettleTimer) clearTimeout(s.convSizeSettleTimer);
    s.convSizeSettleTimer = setTimeout(() => {
      s.convSizeSettleTimer = null;
      if (s.ended || !s.conversationId) return;
      void readConvLogSize(s.cwd, s.conversationId).then((size) => {
        if (s.ended) return;
        if (size > s.knownConvLogSize) s.knownConvLogSize = size;
      });
    }, 1500);
  }

  /** Subscribe to session-list updates. Returns an unsubscribe fn. */
  subscribe(sink: ViewerSink): () => void {
    this.listeners.add(sink);
    sink.send({ type: "sessions", sessions: this.list() });
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
      title: s.title,
      conversationId: s.conversationId,
      externallyUpdated: s.externallyUpdated || undefined,
    };
  }

  private broadcastSessions() {
    const msg: ServerMessage = { type: "sessions", sessions: this.list() };
    for (const l of this.listeners) l.send(msg);
  }

  private recomputePtySize(s: Session): void {
    if (s.ended) return;
    const next = minViewerDims(s.viewers.values());
    if (!next) return;
    if (s.cols === next.cols && s.rows === next.rows) return;
    s.cols = next.cols;
    s.rows = next.rows;
    try {
      s.pty.resize(next.cols, next.rows);
    } catch {
      // PTY may have just died
    }
  }

  async create(
    cwd: string,
    cols: number,
    rows: number,
    mode: CreateMode = { kind: "new" }
  ): Promise<SessionInfo> {
    const id = randomBytes(8).toString("hex");
    const cwdLabel = labelFor(cwd);
    const args =
      mode.kind === "continue"
        ? ["--continue"]
        : mode.kind === "resume"
          ? ["--resume", mode.conversationId]
          : [];

    // Snapshot existing conversation files so a new one created by this PTY
    // can be attributed back to this session in refreshTitles().
    const preexistingConvFiles = new Set(await listConversationFiles(cwd));

    // For continue/resume we already know which conversation will be appended to.
    const knownConvId =
      mode.kind === "resume"
        ? mode.conversationId
        : mode.kind === "continue"
          ? await mostRecentConversationId(cwd)
          : undefined;

    // If a live session already owns this conversation, hand that one back
    // instead of spawning a second PTY against the same JSONL.
    if (knownConvId) {
      for (const existing of this.sessions.values()) {
        if (!existing.ended && existing.conversationId === knownConvId) {
          return this.toInfo(existing);
        }
      }
    }
    const ptyProc = spawn(this.command, args, {
      name: "xterm-256color",
      cols: Math.max(20, cols | 0),
      rows: Math.max(5, rows | 0),
      cwd,
      env: { ...process.env, TERM: "xterm-256color" },
    });

    const session: Session = {
      id,
      cwd,
      cwdLabel,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      cols: cols | 0,
      rows: rows | 0,
      pty: ptyProc,
      ringBuffer: Buffer.alloc(0),
      viewers: new Map(),
      ended: false,
      preexistingConvFiles,
      conversationId: knownConvId ?? undefined,
      promptIdleTimer: null,
      lastPromptNotifyAt: 0,
      knownConvLogSize: 0,
      lastPtyDataAt: 0,
      convSizeSettleTimer: null,
      externallyUpdated: false,
    };

    // Seed the known log size if we already know which conversation we're bound to.
    if (knownConvId) {
      void readConvLogSize(cwd, knownConvId).then((sz) => {
        if (!session.ended && session.knownConvLogSize === 0) {
          session.knownConvLogSize = sz;
        }
      });
    }

    // Resolve the title now if we already know the conversation id.
    if (session.conversationId) {
      void readFirstUserMessage(cwd, session.conversationId).then((title) => {
        if (title && !session.title) {
          session.title = title;
          this.broadcastSessions();
        }
      });
    }

    ptyProc.onData((data) => {
      const now = Date.now();
      session.lastActivityAt = now;
      session.lastPtyDataAt = now;
      session.ringBuffer = appendRing(session.ringBuffer, data);
      const msg: ServerMessage = { type: "output", sessionId: id, data };
      for (const v of session.viewers.keys()) v.send(msg);
      this.scheduleIdlePromptCheck(session);
      this.scheduleConvSizeSnapshot(session);
    });

    ptyProc.onExit(({ exitCode }) => {
      session.ended = true;
      if (session.promptIdleTimer) {
        clearTimeout(session.promptIdleTimer);
        session.promptIdleTimer = null;
      }
      if (session.convSizeSettleTimer) {
        clearTimeout(session.convSizeSettleTimer);
        session.convSizeSettleTimer = null;
      }
      const msg: ServerMessage = { type: "ended", sessionId: id, exitCode: exitCode ?? 0 };
      for (const v of session.viewers.keys()) v.send(msg);
      this.sessions.delete(id);
      this.broadcastSessions();
    });

    this.sessions.set(id, session);
    this.broadcastSessions();
    return this.toInfo(session);
  }

  attach(sessionId: string, viewer: ViewerSink, cols: number, rows: number): SessionInfo | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    s.viewers.set(viewer, { cols: Math.max(20, cols | 0), rows: Math.max(5, rows | 0) });
    this.recomputePtySize(s);
    viewer.send({ type: "attached", sessionId, replay: s.ringBuffer.toString("utf8") });
    this.broadcastSessions();
    return this.toInfo(s);
  }

  detach(sessionId: string, viewer: ViewerSink) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.viewers.delete(viewer)) {
      this.recomputePtySize(s);
      this.broadcastSessions();
    }
  }

  detachEverywhere(viewer: ViewerSink) {
    let changed = false;
    for (const s of this.sessions.values()) {
      if (s.viewers.delete(viewer)) {
        this.recomputePtySize(s);
        changed = true;
      }
    }
    if (changed) this.broadcastSessions();
  }

  input(sessionId: string, data: string) {
    const s = this.sessions.get(sessionId);
    if (s && !s.ended) {
      s.lastActivityAt = Date.now();
      s.pty.write(data);
    }
  }

  resize(sessionId: string, viewer: ViewerSink, cols: number, rows: number) {
    const s = this.sessions.get(sessionId);
    if (!s || s.ended) return;
    const dims = s.viewers.get(viewer);
    if (!dims) return;
    dims.cols = Math.max(20, cols | 0);
    dims.rows = Math.max(5, rows | 0);
    const before = `${s.cols}x${s.rows}`;
    this.recomputePtySize(s);
    if (`${s.cols}x${s.rows}` !== before) this.broadcastSessions();
  }

  /**
   * Kill the PTY for `sessionId`, wait for the conversation JSONL to stop
   * growing (so another writer has time to flush), then spawn a fresh PTY
   * with `--resume <conversationId>`. Returns the new session info, or null
   * if the input session can't be reloaded (no conversationId, already gone).
   */
  async reload(sessionId: string, cols: number, rows: number): Promise<SessionInfo | null> {
    const s = this.sessions.get(sessionId);
    if (!s || !s.conversationId) return null;
    const cwd = s.cwd;
    const conversationId = s.conversationId;

    // Capture pty + ended-promise before issuing kill so we can wait it out.
    const exited = new Promise<void>((resolve) => {
      const prev = s.pty.onExit(() => {
        resolve();
        try {
          prev.dispose();
        } catch {
          // already disposed
        }
      });
    });

    try {
      s.pty.kill();
    } catch {
      // already dead
    }
    await Promise.race([exited, sleep(2000)]);

    await this.waitForConvLogStable(cwd, conversationId);

    return this.create(cwd, cols, rows, { kind: "resume", conversationId });
  }

  /**
   * Poll the conversation JSONL until its size hasn't changed for STABLE_MS.
   * Bounded by MAX_MS so a continuously-writing peer can't block forever.
   */
  private async waitForConvLogStable(cwd: string, conversationId: string): Promise<void> {
    const POLL_MS = 100;
    const STABLE_MS = 500;
    const MAX_MS = 3000;
    const start = Date.now();
    let lastSize = await readConvLogSize(cwd, conversationId);
    let stableSince = Date.now();
    while (Date.now() - start < MAX_MS) {
      await sleep(POLL_MS);
      const size = await readConvLogSize(cwd, conversationId);
      if (size === lastSize) {
        if (Date.now() - stableSince >= STABLE_MS) return;
      } else {
        lastSize = size;
        stableSince = Date.now();
      }
    }
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

export function minViewerDims(viewers: Iterable<ViewerDims>): ViewerDims | null {
  let cols = Infinity;
  let rows = Infinity;
  let any = false;
  for (const v of viewers) {
    any = true;
    if (v.cols < cols) cols = v.cols;
    if (v.rows < rows) rows = v.rows;
  }
  if (!any || !Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  return { cols, rows };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readConvLogSize(cwd: string, conversationId: string): Promise<number> {
  try {
    const s = await stat(join(projectsDirFor(cwd), `${conversationId}.jsonl`));
    return s.size;
  } catch {
    return 0;
  }
}

export function appendRing(buf: Buffer, chunk: string): Buffer {
  const next = buf.length === 0 ? Buffer.from(chunk, "utf8") : Buffer.concat([buf, Buffer.from(chunk, "utf8")]);
  if (next.length <= RING_BUFFER_BYTES + RING_SLACK_BYTES) return next;
  let offset = next.length - RING_BUFFER_BYTES;
  // Advance past UTF-8 continuation bytes (0x80–0xBF) to land on a character boundary
  while (offset < next.length && (next[offset]! & 0xc0) === 0x80) offset++;
  return Buffer.from(next.subarray(offset));
}
