import { describe, it, expect } from "vitest";
import { generateToken, tokensMatch } from "./auth.ts";

describe("generateToken", () => {
  it("returns a url-safe base64 string", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns different tokens on each call", () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it("returns at least 24 bytes worth of entropy", () => {
    expect(generateToken().length).toBeGreaterThanOrEqual(32);
  });
});

describe("tokensMatch", () => {
  it("returns true when no token is required", () => {
    expect(tokensMatch(null, null)).toBe(true);
    expect(tokensMatch(null, "anything")).toBe(true);
    expect(tokensMatch("", "anything")).toBe(true);
  });

  it("returns false when token required but missing", () => {
    expect(tokensMatch("secret", null)).toBe(false);
    expect(tokensMatch("secret", "")).toBe(false);
  });

  it("returns true on exact match", () => {
    expect(tokensMatch("abc123", "abc123")).toBe(true);
  });

  it("returns false on mismatch", () => {
    expect(tokensMatch("abc123", "abc124")).toBe(false);
  });

  it("returns false on length mismatch without throwing", () => {
    expect(tokensMatch("abc", "abcd")).toBe(false);
    expect(tokensMatch("abcd", "abc")).toBe(false);
  });
});
