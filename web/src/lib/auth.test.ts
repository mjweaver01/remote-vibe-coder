import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshAuth() {
  vi.resetModules();
  return await import("./auth.ts");
}

beforeEach(() => {
  sessionStorage.clear();
  // Reset URL to a clean state
  window.history.replaceState({}, "", "/");
});

describe("getToken", () => {
  it("returns null when no token anywhere", async () => {
    const { getToken } = await freshAuth();
    expect(getToken()).toBeNull();
  });

  it("picks up token from query string and persists to sessionStorage", async () => {
    window.history.replaceState({}, "", "/foo?token=abc123");
    const { getToken } = await freshAuth();
    expect(getToken()).toBe("abc123");
    expect(sessionStorage.getItem("rvc.token")).toBe("abc123");
  });

  it("strips the token from the visible URL", async () => {
    window.history.replaceState({}, "", "/foo?token=abc123&other=1");
    const { getToken } = await freshAuth();
    getToken();
    expect(window.location.search).toBe("?other=1");
    expect(window.location.search).not.toContain("token");
  });

  it("falls back to sessionStorage on later loads", async () => {
    sessionStorage.setItem("rvc.token", "stored");
    const { getToken } = await freshAuth();
    expect(getToken()).toBe("stored");
  });

  it("caches across calls", async () => {
    sessionStorage.setItem("rvc.token", "stored");
    const { getToken } = await freshAuth();
    expect(getToken()).toBe("stored");
    sessionStorage.clear();
    // Should still return cached value
    expect(getToken()).toBe("stored");
  });
});

describe("withToken", () => {
  it("returns path unchanged when no token", async () => {
    const { withToken } = await freshAuth();
    expect(withToken("/api/folders")).toBe("/api/folders");
  });

  it("appends token to a path", async () => {
    sessionStorage.setItem("rvc.token", "T");
    const { withToken } = await freshAuth();
    expect(withToken("/api/folders")).toBe("/api/folders?token=T");
  });

  it("merges token into an existing query string", async () => {
    sessionStorage.setItem("rvc.token", "T");
    const { withToken } = await freshAuth();
    const out = withToken("/api/file?path=/x");
    expect(out).toContain("path=%2Fx");
    expect(out).toContain("token=T");
  });

  it("replaces an existing token rather than duplicating it", async () => {
    sessionStorage.setItem("rvc.token", "NEW");
    const { withToken } = await freshAuth();
    const out = withToken("/api/folders?token=OLD");
    expect(out).toBe("/api/folders?token=NEW");
  });
});

describe("wsUrl", () => {
  it("uses ws:// over http://", async () => {
    const { wsUrl } = await freshAuth();
    expect(wsUrl("/ws")).toMatch(/^ws:\/\//);
  });

  it("includes token when present", async () => {
    sessionStorage.setItem("rvc.token", "T");
    const { wsUrl } = await freshAuth();
    expect(wsUrl("/ws")).toContain("token=T");
  });
});
