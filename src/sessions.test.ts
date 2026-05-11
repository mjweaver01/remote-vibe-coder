import { describe, it, expect } from "vitest";
import { appendRing, RING_BUFFER_BYTES } from "./sessions.ts";

describe("appendRing", () => {
  it("appends below the cap without truncating", () => {
    expect(appendRing("hello ", "world")).toBe("hello world");
  });

  it("truncates from the front when exceeding the cap", () => {
    const big = "a".repeat(RING_BUFFER_BYTES);
    const result = appendRing(big, "tail");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(RING_BUFFER_BYTES);
    expect(result.endsWith("tail")).toBe(true);
  });

  it("lands on a UTF-8 character boundary when truncating mid-multibyte", () => {
    // Build a buffer whose truncation point falls inside a multibyte sequence.
    // "你" is 3 bytes in UTF-8. Fill the ring with a mix that forces mid-char truncation.
    const filler = "你".repeat(Math.ceil(RING_BUFFER_BYTES / 3));
    const result = appendRing(filler, "x");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(RING_BUFFER_BYTES);
    // No replacement characters introduced
    expect(result).not.toContain("�");
    expect(result.endsWith("x")).toBe(true);
  });

  it("handles emoji boundaries (4-byte sequences)", () => {
    const filler = "🚀".repeat(Math.ceil(RING_BUFFER_BYTES / 4));
    const result = appendRing(filler, "done");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(RING_BUFFER_BYTES);
    expect(result).not.toContain("�");
    expect(result.endsWith("done")).toBe(true);
  });

  it("returns empty when chunk alone exceeds the cap and nothing fits", () => {
    const chunk = "a".repeat(RING_BUFFER_BYTES + 100);
    const result = appendRing("", chunk);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(RING_BUFFER_BYTES);
    expect(result.endsWith("a")).toBe(true);
  });
});
