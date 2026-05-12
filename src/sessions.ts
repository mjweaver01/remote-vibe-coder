import { spawn, type IPty } from "node-pty";
import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { mostRecentConversationId } from "./claudeProjects.ts";
import { ConversationLogWatcher } from "./convLog.ts";
import { detectPrompt } from "./prompts.ts";
import type { CreateMode, ServerMessage, SessionInfo } from "./types.ts";

export { waitForFileSizeStable, type WaitForFileSizeStableOptions } from "./convLog.ts";

/** Optional sink for push-worthy session events. */
export interface PromptNotifier {
  onPrompt(info: { sessionId: string; cwdLabel: string; title?: string; preview: string }): void;
  onExternalUpdate?(info: { sessionId: string; cwdLabel: string; title?: string }): void;
}

const PROMPT_IDLE_MS = 3000;
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
  promptIdleTimer: ReturnType<typeof setTimeout> | null;
  hasUnseenUpdate: boolean;
  /** Set to true when the local PTY emits substantive output (Claude is
   *  responding or rendering a permission prompt). Cleared after the idle
   *  prompt is detected and a push fires. Ensures we only notify on the
   *  edge from "responding" to "idle," not every time we observe the empty
   *  input box. */
  sawSubstantiveOutput: boolean;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private listeners = new Set<ViewerSink>();
  private command: string;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private notifier: PromptNotifier | null = null;
  private convWatcher = new ConversationLogWatcher();
  private convWatcherUnsub: () => void;
  private convGrowthUnsub: () => void;

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
    this.convWatcherUnsub = this.convWatcher.onChange(() => this.broadcastSessions());
    this.convGrowthUnsub = this.convWatcher.onGrowth((id, kind) => {
      const s = this.sessions.get(id);
      if (!s || s.ended) return;
      if (kind === "external") {
        if (process.env.RVC_DEBUG)
          console.log(`[sessions] growth id=${id} external -> hasUnseenUpdate=true`);
        if (!s.hasUnseenUpdate) {
          s.hasUnseenUpdate = true;
          this.broadcastSessions();
        }
        if (this.notifier?.onExternalUpdate) {
          const conv = this.convWatcher.getState(id);
          this.notifier.onExternalUpdate({
            sessionId: id,
            cwdLabel: s.cwdLabel,
            title: conv?.title,
          });
        }
      } else {
        // local growth: our PTY produced it; attached viewers already see it.
        if (s.hasUnseenUpdate) {
          if (process.env.RVC_DEBUG)
            console.log(`[sessions] growth id=${id} local -> clearing hasUnseenUpdate`);
          s.hasUnseenUpdate = false;
          this.broadcastSessions();
        }
      }
    });
  }

  close() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    for (const s of this.sessions.values()) {
      if (s.promptIdleTimer) {
        clearTimeout(s.promptIdleTimer);
        s.promptIdleTimer = null;
      }
    }
    this.convWatcherUnsub();
    this.convGrowthUnsub();
    this.convWatcher.close();
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
      const tail = s.ringBuffer.subarray(Math.max(0, s.ringBuffer.length - PROMPT_TAIL_BYTES));
      const tailStr = tail.toString("utf8");
      const result = detectPrompt(tailStr);
      if (process.env.RVC_DEBUG) {
        console.log(
          `[prompt-detect] id=${s.id} matched=${result.matched} pattern=${result.pattern ?? "-"}`
        );
        if (!result.matched) {
          const clean = tailStr
            .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
            .replace(/\r(?!\n)/g, "\n");
          console.log(
            "[prompt-detect] tail (last 20 lines):\n" + clean.split("\n").slice(-20).join("\n")
          );
        }
      }
      if (!result.matched) return;
      // Only fire on the edge from "responding" → "idle." If we haven't seen
      // substantive output since the last notification (or since session
      // start), the user is just looking at the empty input box.
      if (!s.sawSubstantiveOutput) return;
      s.sawSubstantiveOutput = false;
      const conv = this.convWatcher.getState(s.id);
      this.notifier?.onPrompt({
        sessionId: s.id,
        cwdLabel: s.cwdLabel,
        title: conv?.title,
        preview: result.preview ?? "Claude is waiting for input",
      });
    }, PROMPT_IDLE_MS);
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
    const conv = this.convWatcher.getState(s.id);
    return {
      id: s.id,
      cwd: s.cwd,
      cwdLabel: s.cwdLabel,
      createdAt: s.createdAt,
      cols: s.cols,
      rows: s.rows,
      viewers: s.viewers.size,
      title: conv?.title,
      conversationId: conv?.conversationId,
      externallyUpdated: s.hasUnseenUpdate || undefined,
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

    // Snapshot existing conversation files BEFORE spawn so a new one created
    // by this PTY can be attributed back to this session.
    const preexistingFiles = await this.convWatcher.snapshotPreexisting(cwd);

    // For continue/resume we already know which conversation will be appended to.
    const knownConvId =
      mode.kind === "resume"
        ? mode.conversationId
        : mode.kind === "continue"
          ? ((await mostRecentConversationId(cwd)) ?? undefined)
          : undefined;

    // If a live session already owns this conversation, hand that one back
    // instead of spawning a second PTY against the same JSONL.
    if (knownConvId) {
      const existingId = this.convWatcher.findByConversationId(knownConvId);
      if (existingId) {
        const existing = this.sessions.get(existingId);
        if (existing && !existing.ended) return this.toInfo(existing);
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
      promptIdleTimer: null,
      hasUnseenUpdate: false,
      sawSubstantiveOutput: false,
    };

    this.convWatcher.track(id, cwd, { knownConvId, preexistingFiles });

    ptyProc.onData((data) => {
      const now = Date.now();
      session.lastActivityAt = now;
      session.ringBuffer = appendRing(session.ringBuffer, data);
      const msg: ServerMessage = { type: "output", sessionId: id, data };
      for (const v of session.viewers.keys()) v.send(msg);
      // Substantive (non-cosmetic) output = Claude is producing a response or
      // a permission prompt. Arm the notify-on-next-idle flag.
      const stripped = data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").trim();
      if (stripped.length >= 80) session.sawSubstantiveOutput = true;
      this.scheduleIdlePromptCheck(session);
      this.convWatcher.notePtyOutput(id, data);
    });

    ptyProc.onExit(({ exitCode }) => {
      session.ended = true;
      if (session.promptIdleTimer) {
        clearTimeout(session.promptIdleTimer);
        session.promptIdleTimer = null;
      }
      const msg: ServerMessage = { type: "ended", sessionId: id, exitCode: exitCode ?? 0 };
      for (const v of session.viewers.keys()) v.send(msg);
      this.sessions.delete(id);
      this.convWatcher.untrack(id);
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
    // Advance the JSONL watermark so prior external growth doesn't re-fire,
    // but keep `hasUnseenUpdate` set so the SessionPage banner can prompt the
    // user to reload. The flag clears naturally when reload spawns a new
    // session (and this stale one ends).
    void this.convWatcher.markBaseline(sessionId);
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
    if (!s) return null;
    const conv = this.convWatcher.getState(sessionId);
    if (!conv?.conversationId) return null;
    const cwd = s.cwd;
    const conversationId = conv.conversationId;

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

    await this.convWatcher.waitForStable(cwd, conversationId);

    return this.create(cwd, cols, rows, { kind: "resume", conversationId });
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

export function appendRing(buf: Buffer, chunk: string): Buffer {
  const next =
    buf.length === 0
      ? Buffer.from(chunk, "utf8")
      : Buffer.concat([buf, Buffer.from(chunk, "utf8")]);
  if (next.length <= RING_BUFFER_BYTES + RING_SLACK_BYTES) return next;
  let offset = next.length - RING_BUFFER_BYTES;
  // Advance past UTF-8 continuation bytes (0x80–0xBF) to land on a character boundary
  while (offset < next.length && (next[offset]! & 0xc0) === 0x80) offset++;
  return Buffer.from(next.subarray(offset));
}
