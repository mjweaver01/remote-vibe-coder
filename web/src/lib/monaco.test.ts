import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshLoader() {
  vi.resetModules();
  return await import("./monaco.ts");
}

beforeEach(() => {
  // Strip any leftover monaco script tags + globals between tests
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete (window as any).monaco;
  delete (window as any).require;
});

describe("loadMonaco", () => {
  it("resolves immediately if window.monaco is already present", async () => {
    (window as any).monaco = { editor: { create: () => null } };
    const { loadMonaco } = await freshLoader();
    await expect(loadMonaco()).resolves.toBe((window as any).monaco);
  });

  it("appends a script tag pointing at the AMD loader", async () => {
    const { loadMonaco } = await freshLoader();
    void loadMonaco();
    const scripts = Array.from(document.head.querySelectorAll("script"));
    expect(scripts.some((s) => s.src.endsWith("/assets/monaco/vs/loader.js"))).toBe(true);
  });

  it("returns the cached promise on repeat calls", async () => {
    const { loadMonaco } = await freshLoader();
    const p1 = loadMonaco();
    const p2 = loadMonaco();
    expect(p1).toBe(p2);
  });

  it("removes the script element and clears the cached promise on script error", async () => {
    const { loadMonaco } = await freshLoader();
    const promise = loadMonaco();
    const script = document.head.querySelector("script");
    expect(script).not.toBeNull();
    script!.onerror!(new Event("error"));
    await expect(promise).rejects.toThrow(/Failed to load/);
    expect(document.head.querySelector("script")).toBeNull();
    // Cache was cleared — a new call starts fresh
    const next = loadMonaco();
    expect(next).not.toBe(promise);
  });

  it("rejects after the 15s timeout and removes the script tag", async () => {
    vi.useFakeTimers();
    try {
      const { loadMonaco } = await freshLoader();
      const promise = loadMonaco();
      promise.catch(() => {});
      expect(document.head.querySelector("script")).not.toBeNull();
      vi.advanceTimersByTime(15_001);
      await expect(promise).rejects.toThrow(/timed out/);
      expect(document.head.querySelector("script")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("languageForFile", () => {
  it("maps common extensions", async () => {
    const { languageForFile } = await freshLoader();
    expect(languageForFile("a.ts")).toBe("typescript");
    expect(languageForFile("a.tsx")).toBe("typescript");
    expect(languageForFile("a.py")).toBe("python");
    expect(languageForFile("a.json")).toBe("json");
  });

  it("handles Dockerfile by name", async () => {
    const { languageForFile } = await freshLoader();
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
  });

  it("falls back to plaintext for unknown extensions", async () => {
    const { languageForFile } = await freshLoader();
    expect(languageForFile("README")).toBe("plaintext");
    expect(languageForFile("a.zzz")).toBe("plaintext");
  });

  it("is case-insensitive", async () => {
    const { languageForFile } = await freshLoader();
    expect(languageForFile("A.TS")).toBe("typescript");
  });
});
