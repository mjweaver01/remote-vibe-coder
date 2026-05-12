import { describe, expect, it } from "vitest";
import { detectPrompt } from "./prompts.ts";

describe("detectPrompt", () => {
  it("matches permission menu cursor", () => {
    const tail = "Do you want to proceed?\n❯ 1. Yes\n  2. No\n";
    const r = detectPrompt(tail);
    expect(r.matched).toBe(true);
  });

  it("matches y/n prompt", () => {
    expect(detectPrompt("Continue? (y/n)\n").matched).toBe(true);
  });

  it("matches the idle input prompt", () => {
    const tail = [
      "Some assistant output here.",
      "──────────────────────────────",
      "❯ ",
      "──────────────────────────────",
      "?for shortcuts ◐ medium · /effort",
    ].join("\n");
    const r = detectPrompt(tail);
    expect(r.matched).toBe(true);
    expect(r.pattern).toBe("input-box-idle");
  });

  it("rejects the idle prompt when a thinking spinner is visible above the box", () => {
    const tail = [
      "Some assistant output here.",
      "",
      "✶ Pondering… (4s)",
      "─────────────────",
      "❯ ",
      "─────────────────",
      "?for shortcuts ◐ medium · /effort",
    ].join("\n");
    expect(detectPrompt(tail).matched).toBe(false);
  });

  it("rejects the idle prompt during a tool call", () => {
    const tail = [
      "Previous response text.",
      "",
      "⏺ Bash(npm test)",
      "─────────────────",
      "❯ ",
      "─────────────────",
      "?for shortcuts",
    ].join("\n");
    expect(detectPrompt(tail).matched).toBe(false);
  });

  it("matches the compact status-line variant", () => {
    const tail = [
      "─────────────────",
      "❯  ",
      "─────────────────",
      "?forshortcuts◐medium·/effort",
    ].join("\n");
    expect(detectPrompt(tail).matched).toBe(true);
  });

  it("does not match plain assistant output", () => {
    expect(detectPrompt("Here is a plain response with no prompt.\n").matched).toBe(false);
  });

  it("strips ANSI before matching", () => {
    const tail =
      "\x1b[33m──────\x1b[0m\n\x1b[33m❯ \x1b[0m\n\x1b[33m──────\x1b[0m\n?for shortcuts\n";
    expect(detectPrompt(tail).matched).toBe(true);
  });
});
