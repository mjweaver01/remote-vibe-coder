import { describe, it, expect } from "vitest";
import {
  appendRing,
  minViewerDims,
  RING_BUFFER_BYTES,
  SessionManager,
  waitForFileSizeStable,
  type ViewerSink,
} from "./sessions.ts";
import type { ServerMessage, SessionInfo } from "./types.ts";

const empty = Buffer.alloc(0);
const buf = (s: string) => Buffer.from(s, "utf8");
const MAX_RETAINED = Math.floor(RING_BUFFER_BYTES * 1.5);

describe("appendRing", () => {
  it("appends below the cap without truncating", () => {
    expect(appendRing(buf("hello "), "world").toString("utf8")).toBe("hello world");
  });

  it("trims to within the cap once it exceeds cap+slack", () => {
    let ring: Buffer = buf("a".repeat(RING_BUFFER_BYTES));
    // Keep feeding small chunks; once we cross cap+slack it must trim back to <= cap.
    for (let i = 0; i < 100; i++) ring = appendRing(ring, "tail");
    expect(ring.length).toBeLessThanOrEqual(MAX_RETAINED);
    expect(ring.toString("utf8").endsWith("tail")).toBe(true);
  });

  it("lands on a UTF-8 character boundary when trimming mid-multibyte", () => {
    // "你" is 3 bytes in UTF-8. Force enough content to push past cap+slack.
    let ring: Buffer = buf("你".repeat(Math.ceil((RING_BUFFER_BYTES * 2) / 3)));
    ring = appendRing(ring, "x");
    expect(ring.length).toBeLessThanOrEqual(MAX_RETAINED);
    const s = ring.toString("utf8");
    expect(s).not.toContain("�");
    expect(s.endsWith("x")).toBe(true);
  });

  it("handles emoji boundaries (4-byte sequences)", () => {
    let ring: Buffer = buf("🚀".repeat(Math.ceil((RING_BUFFER_BYTES * 2) / 4)));
    ring = appendRing(ring, "done");
    expect(ring.length).toBeLessThanOrEqual(MAX_RETAINED);
    const s = ring.toString("utf8");
    expect(s).not.toContain("�");
    expect(s.endsWith("done")).toBe(true);
  });

  it("trims when a single chunk alone exceeds the cap+slack", () => {
    const chunk = "a".repeat(RING_BUFFER_BYTES * 3);
    const result = appendRing(empty, chunk);
    expect(result.length).toBeLessThanOrEqual(MAX_RETAINED);
    expect(result.toString("utf8").endsWith("a")).toBe(true);
  });
});

describe("minViewerDims", () => {
  it("returns null for an empty set", () => {
    expect(minViewerDims([])).toBeNull();
  });

  it("returns the only viewer's dims", () => {
    expect(minViewerDims([{ cols: 120, rows: 40 }])).toEqual({ cols: 120, rows: 40 });
  });

  it("returns the min cols and min rows across viewers", () => {
    expect(
      minViewerDims([
        { cols: 200, rows: 60 },
        { cols: 40, rows: 24 }, // phone
        { cols: 120, rows: 50 },
      ])
    ).toEqual({ cols: 40, rows: 24 });
  });

  it("picks min cols and min rows independently", () => {
    // Smallest cols comes from viewer A, smallest rows from viewer B.
    expect(
      minViewerDims([
        { cols: 40, rows: 80 },
        { cols: 200, rows: 24 },
      ])
    ).toEqual({ cols: 40, rows: 24 });
  });
});

describe("SessionManager resize policy", () => {
  const sink = (): ViewerSink => ({ send() {} });

  function observer(): { sink: ViewerSink; sessions: () => SessionInfo[] } {
    let last: SessionInfo[] = [];
    return {
      sink: {
        send(m: ServerMessage) {
          if (m.type === "sessions") last = m.sessions;
        },
      },
      sessions: () => last,
    };
  }

  async function withSession(
    fn: (mgr: SessionManager, id: string, obs: ReturnType<typeof observer>) => Promise<void>
  ) {
    // `cat` sits idle reading stdin — a real PTY that won't exit on its own.
    const mgr = new SessionManager({ command: "cat" });
    const obs = observer();
    mgr.subscribe(obs.sink);
    const created = await mgr.create(process.cwd(), 100, 30);
    try {
      await fn(mgr, created.id, obs);
    } finally {
      mgr.kill(created.id);
      mgr.close();
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it("shrinks the PTY to the smallest attached viewer", async () => {
    await withSession(async (mgr, id, obs) => {
      const laptop = sink();
      const phone = sink();
      mgr.attach(id, laptop, 200, 50);
      const before = obs.sessions().find((s) => s.id === id)!;
      expect(before.cols).toBe(200);
      expect(before.rows).toBe(50);

      mgr.attach(id, phone, 40, 24);
      const after = obs.sessions().find((s) => s.id === id)!;
      expect(after.cols).toBe(40);
      expect(after.rows).toBe(24);
    });
  });

  it("grows the PTY back when the smaller viewer detaches", async () => {
    await withSession(async (mgr, id, obs) => {
      const laptop = sink();
      const phone = sink();
      mgr.attach(id, laptop, 200, 50);
      mgr.attach(id, phone, 40, 24);
      expect(obs.sessions().find((s) => s.id === id)!.cols).toBe(40);

      mgr.detach(id, phone);
      const after = obs.sessions().find((s) => s.id === id)!;
      expect(after.cols).toBe(200);
      expect(after.rows).toBe(50);
    });
  });

  it("recomputes when an attached viewer resizes", async () => {
    await withSession(async (mgr, id, obs) => {
      const laptop = sink();
      const phone = sink();
      mgr.attach(id, laptop, 200, 50);
      mgr.attach(id, phone, 40, 24);

      // Phone rotates — now larger than laptop on cols.
      mgr.resize(id, phone, 300, 80);
      const after = obs.sessions().find((s) => s.id === id)!;
      expect(after.cols).toBe(200); // laptop now smallest on cols
      expect(after.rows).toBe(50); // laptop still smallest on rows
    });
  });
});

describe("waitForFileSizeStable", () => {
  it("resolves immediately once size stays stable for the window", async () => {
    let calls = 0;
    const start = Date.now();
    await waitForFileSizeStable(
      async () => {
        calls++;
        return 42; // never changes
      },
      { pollMs: 20, stableMs: 100, maxMs: 1000 }
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(400);
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(calls).toBeGreaterThan(1);
  });

  it("keeps waiting while size still grows, then resolves after it settles", async () => {
    let size = 0;
    const start = Date.now();
    // Grow for 200ms, then plateau.
    const growTimer = setInterval(() => {
      if (Date.now() - start < 200) size += 10;
    }, 30);
    try {
      await waitForFileSizeStable(async () => size, {
        pollMs: 30,
        stableMs: 120,
        maxMs: 2000,
      });
    } finally {
      clearInterval(growTimer);
    }
    const elapsed = Date.now() - start;
    // Must wait at least until growth stopped (200ms) plus the stable window.
    expect(elapsed).toBeGreaterThanOrEqual(280);
    expect(size).toBeGreaterThan(0);
  });

  it("respects maxMs even if size keeps changing forever", async () => {
    let size = 0;
    const start = Date.now();
    await waitForFileSizeStable(
      async () => {
        size += 1;
        return size;
      },
      { pollMs: 20, stableMs: 100, maxMs: 250 }
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(240);
    expect(elapsed).toBeLessThan(600);
  });
});

describe("SessionManager.reload", () => {
  it("returns null for an unknown session id", async () => {
    const mgr = new SessionManager({ command: "cat" });
    try {
      const out = await mgr.reload("does-not-exist", 80, 24);
      expect(out).toBeNull();
    } finally {
      mgr.close();
    }
  });

  it("returns null when the session has no conversation bound", async () => {
    // A "new" session against a directory with no Claude project dir won't get
    // a conversationId, so reload has nothing to --resume against.
    const mgr = new SessionManager({ command: "cat" });
    try {
      const created = await mgr.create(process.cwd(), 80, 24);
      const out = await mgr.reload(created.id, 80, 24);
      expect(out).toBeNull();
      mgr.kill(created.id);
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      mgr.close();
    }
  });
});
