import { stat } from "node:fs/promises";
import { join } from "node:path";
import { listConversationFiles, projectsDirFor, readFirstUserMessage } from "./claudeProjects.ts";

const REFRESH_MS = 3000;
const QUIET_MS = 2500;
const SETTLE_MS = 1500;

export interface ConvLogState {
  conversationId?: string;
  title?: string;
  externallyUpdated: boolean;
}

interface Entry {
  cwd: string;
  conversationId?: string;
  title?: string;
  preexistingFiles: Set<string>;
  knownConvLogSize: number;
  lastPtyDataAt: number;
  settleTimer: ReturnType<typeof setTimeout> | null;
  externallyUpdated: boolean;
}

export interface TrackOptions {
  knownConvId?: string;
  preexistingFiles: Set<string>;
}

/**
 * Watches the Claude Code conversation JSONL log on disk for each tracked
 * session. Resolves the conversation id for freshly-spawned PTYs, reads the
 * first user message as a title, and detects when an external `claude` process
 * has appended to the same conversation while our PTY was quiet.
 */
export class ConversationLogWatcher {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private refreshTimer: ReturnType<typeof setInterval> | null;

  constructor() {
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  close(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const e of this.entries.values()) {
      if (e.settleTimer) clearTimeout(e.settleTimer);
    }
    this.entries.clear();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
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
      settleTimer: null,
      externallyUpdated: false,
    };
    this.entries.set(id, entry);
    if (entry.conversationId) {
      const convId = entry.conversationId;
      void readConvLogSize(cwd, convId).then((sz) => {
        if (this.entries.get(id) === entry && entry.knownConvLogSize === 0) {
          entry.knownConvLogSize = sz;
        }
      });
      void readFirstUserMessage(cwd, convId).then((title) => {
        if (title && this.entries.get(id) === entry && !entry.title) {
          entry.title = title;
          this.emitChange();
        }
      });
    }
  }

  untrack(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.settleTimer) clearTimeout(e.settleTimer);
    this.entries.delete(id);
  }

  /** Note that the PTY for `id` just emitted output. Debounces a size snapshot
   *  so growth that actually came from our own PTY doesn't get misattributed
   *  to an external writer. */
  notePtyOutput(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.lastPtyDataAt = Date.now();
    if (!e.conversationId) return;
    if (e.settleTimer) clearTimeout(e.settleTimer);
    const convId = e.conversationId;
    e.settleTimer = setTimeout(() => {
      e.settleTimer = null;
      void readConvLogSize(e.cwd, convId).then((size) => {
        if (this.entries.get(id) !== e) return;
        if (size > e.knownConvLogSize) e.knownConvLogSize = size;
      });
    }, SETTLE_MS);
  }

  getState(id: string): ConvLogState | null {
    const e = this.entries.get(id);
    if (!e) return null;
    return {
      conversationId: e.conversationId,
      title: e.title,
      externallyUpdated: e.externallyUpdated,
    };
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
    for (const e of this.entries.values()) {
      if (!e.conversationId) {
        const files = await listConversationFiles(e.cwd);
        const fresh = files.find((f) => !e.preexistingFiles.has(f));
        if (fresh) {
          e.conversationId = fresh.replace(/\.jsonl$/, "");
        }
      }
      if (!e.conversationId) continue;
      if (!e.title) {
        const title = await readFirstUserMessage(e.cwd, e.conversationId);
        if (title) {
          e.title = title;
          changed = true;
        }
      }
      if (await this.checkExternalGrowth(e)) changed = true;
    }
    if (changed) this.emitChange();
  }

  /**
   * Compare the conversation JSONL size on disk vs the size we recorded after
   * our PTY last emitted output. Growth that arrives while our PTY has been
   * quiet for QUIET_MS is treated as an external `claude` process appending to
   * the same conversation — the user's terminal here can't show those changes
   * without a restart.
   */
  private async checkExternalGrowth(e: Entry): Promise<boolean> {
    if (!e.conversationId) return false;
    const size = await readConvLogSize(e.cwd, e.conversationId);
    if (e.knownConvLogSize === 0) {
      e.knownConvLogSize = size;
      return false;
    }
    if (Date.now() - e.lastPtyDataAt < QUIET_MS) return false;
    if (size <= e.knownConvLogSize) {
      if (size !== e.knownConvLogSize) e.knownConvLogSize = size;
      return false;
    }
    if (!e.externallyUpdated) {
      e.externallyUpdated = true;
      return true;
    }
    return false;
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
