import { stat } from "node:fs/promises";
import { join } from "node:path";
import { listConversationFiles, projectsDirFor, readConversationTitle } from "./claudeProjects.ts";

const REFRESH_MS = 3000;
// JSONL growth while our PTY has been quiet for this long is treated as an
// external writer. Cosmetic redraws are filtered before they reset the timer.
const QUIET_MS = 5_000;
// PTY data chunks smaller than this (after ANSI strip) are treated as
// cosmetic redraws (status bar refresh, cursor blink) and don't reset the
// quiet timer.
const SUBSTANTIVE_BYTES = 80;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const DEBUG = !!process.env.RVC_DEBUG;
function dlog(...args: unknown[]): void {
  if (DEBUG) console.log("[conv-log]", ...args);
}

export type GrowthKind = "local" | "external";

export interface ConvLogState {
  conversationId?: string;
  title?: string;
}

interface Entry {
  cwd: string;
  conversationId?: string;
  title?: string;
  preexistingFiles: Set<string>;
  knownConvLogSize: number;
  lastPtyDataAt: number;
}

export interface TrackOptions {
  knownConvId?: string;
  preexistingFiles: Set<string>;
}

/**
 * Watches the Claude Code conversation JSONL log on disk for each tracked
 * session. Resolves the conversation id for freshly-spawned PTYs, reads the
 * first user message as a title, and classifies JSONL growth as either
 * `local` (our PTY recently wrote substantive output) or `external` (an
 * outside process appended while our PTY was quiet).
 */
export class ConversationLogWatcher {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private growthListeners = new Set<(id: string, kind: GrowthKind) => void>();
  private refreshTimer: ReturnType<typeof setInterval> | null;

  constructor() {
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  close(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.entries.clear();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Fires every time a tracked session's JSONL grows. */
  onGrowth(cb: (id: string, kind: GrowthKind) => void): () => void {
    this.growthListeners.add(cb);
    return () => this.growthListeners.delete(cb);
  }

  /** Snapshot existing conversation files so a new one created by an
   *  about-to-spawn PTY can be attributed back to it later. */
  async snapshotPreexisting(cwd: string): Promise<Set<string>> {
    return new Set(await listConversationFiles(cwd));
  }

  track(id: string, cwd: string, opts: TrackOptions): void {
    const entry: Entry = {
      cwd,
      conversationId: opts.knownConvId,
      preexistingFiles: opts.preexistingFiles,
      knownConvLogSize: 0,
      lastPtyDataAt: 0,
    };
    this.entries.set(id, entry);
    if (entry.conversationId) {
      const convId = entry.conversationId;
      void readConvLogSize(cwd, convId).then((sz) => {
        if (this.entries.get(id) === entry && entry.knownConvLogSize === 0) {
          entry.knownConvLogSize = sz;
        }
      });
      void readConversationTitle(cwd, convId).then((title) => {
        if (title && this.entries.get(id) === entry && !entry.title) {
          entry.title = title;
          this.emitChange();
        }
      });
    }
  }

  untrack(id: string): void {
    this.entries.delete(id);
  }

  /** Note that the PTY for `id` just emitted output. Cosmetic redraws are
   *  filtered out — only substantive content updates the quiet timer. */
  notePtyOutput(id: string, data: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    const stripped = data.replace(ANSI_RE, "").trim();
    if (stripped.length < SUBSTANTIVE_BYTES) {
      dlog(`pty-output cosmetic id=${id} bytes=${stripped.length}`);
      return;
    }
    e.lastPtyDataAt = Date.now();
  }

  /** Reset the size watermark to the current JSONL size — call when a viewer
   *  attaches so prior growth doesn't immediately re-trip. */
  async markBaseline(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e?.conversationId) return;
    const size = await readConvLogSize(e.cwd, e.conversationId);
    if (this.entries.get(id) !== e) return;
    if (size > e.knownConvLogSize) {
      dlog(`markBaseline id=${id} ${e.knownConvLogSize} -> ${size}`);
      e.knownConvLogSize = size;
    }
  }

  getState(id: string): ConvLogState | null {
    const e = this.entries.get(id);
    if (!e) return null;
    return { conversationId: e.conversationId, title: e.title };
  }

  /** Return the tracked session id whose live PTY owns this conversation, if any. */
  findByConversationId(convId: string): string | null {
    for (const [id, e] of this.entries) {
      if (e.conversationId === convId) return id;
    }
    return null;
  }

  async waitForStable(cwd: string, conversationId: string): Promise<void> {
    await waitForFileSizeStable(() => readConvLogSize(cwd, conversationId));
  }

  private emitChange(): void {
    for (const l of this.listeners) l();
  }

  private async refresh(): Promise<void> {
    let changed = false;
    const events: Array<[string, GrowthKind]> = [];
    for (const [id, e] of this.entries) {
      if (!e.conversationId) {
        const files = await listConversationFiles(e.cwd);
        const fresh = files.find((f) => !e.preexistingFiles.has(f));
        if (fresh) e.conversationId = fresh.replace(/\.jsonl$/, "");
      }
      if (!e.conversationId) continue;
      if (!e.title) {
        const title = await readConversationTitle(e.cwd, e.conversationId);
        if (title) {
          e.title = title;
          changed = true;
        }
      }
      const size = await readConvLogSize(e.cwd, e.conversationId);
      if (e.knownConvLogSize === 0) {
        e.knownConvLogSize = size;
      } else if (size > e.knownConvLogSize) {
        const quietMs = Date.now() - e.lastPtyDataAt;
        const kind: GrowthKind = quietMs > QUIET_MS ? "external" : "local";
        dlog(`growth id=${id} ${e.knownConvLogSize} -> ${size} kind=${kind} quietMs=${quietMs}`);
        e.knownConvLogSize = size;
        events.push([id, kind]);
      } else if (size < e.knownConvLogSize) {
        e.knownConvLogSize = size;
      }
    }
    if (changed) this.emitChange();
    for (const [id, kind] of events) {
      for (const l of this.growthListeners) l(id, kind);
    }
  }
}

export interface WaitForFileSizeStableOptions {
  /** Required quiet window before declaring stable. */
  stableMs?: number;
  /** Sampling interval. */
  pollMs?: number;
  /** Hard ceiling; resolves regardless once exceeded. */
  maxMs?: number;
}

/**
 * Poll `read()` until the returned size hasn't changed for `stableMs`, or
 * `maxMs` elapses. Exported so the stability heuristic can be tested without
 * spinning up a PTY.
 */
export async function waitForFileSizeStable(
  read: () => Promise<number>,
  opts: WaitForFileSizeStableOptions = {}
): Promise<void> {
  const pollMs = opts.pollMs ?? 100;
  const stableMs = opts.stableMs ?? 500;
  const maxMs = opts.maxMs ?? 3000;
  const start = Date.now();
  let lastSize = await read();
  let stableSince = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(pollMs);
    const size = await read();
    if (size === lastSize) {
      if (Date.now() - stableSince >= stableMs) return;
    } else {
      lastSize = size;
      stableSince = Date.now();
    }
  }
}

async function readConvLogSize(cwd: string, conversationId: string): Promise<number> {
  try {
    const s = await stat(join(projectsDirFor(cwd), `${conversationId}.jsonl`));
    return s.size;
  } catch {
    return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
