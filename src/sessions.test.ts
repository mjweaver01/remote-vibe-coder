import { describe, it, expect } from "vitest";
import { appendRing, RING_BUFFER_BYTES } from "./sessions.ts";

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
