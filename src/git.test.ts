import { describe, it, expect } from "vitest";
import { parsePorcelainZ } from "./git.ts";

const ROOT = "/repo";

describe("parsePorcelainZ", () => {
  it("returns empty for empty input", () => {
    const r = parsePorcelainZ("", ROOT);
    expect(r).toEqual({ staged: [], unstaged: [], untracked: [] });
  });

  it("parses an untracked file", () => {
    const r = parsePorcelainZ("?? new.txt\0", ROOT);
    expect(r.untracked).toHaveLength(1);
    expect(r.untracked[0]).toMatchObject({ relPath: "new.txt", indexStatus: "?", workingStatus: "?" });
    expect(r.staged).toHaveLength(0);
    expect(r.unstaged).toHaveLength(0);
  });

  it("parses a staged modification (M )", () => {
    const r = parsePorcelainZ("M  src/a.ts\0", ROOT);
    expect(r.staged).toHaveLength(1);
    expect(r.staged[0]).toMatchObject({ relPath: "src/a.ts", indexStatus: "M", workingStatus: " " });
    expect(r.unstaged).toHaveLength(0);
  });

  it("parses an unstaged modification ( M)", () => {
    const r = parsePorcelainZ(" M src/a.ts\0", ROOT);
    expect(r.unstaged).toHaveLength(1);
    expect(r.unstaged[0]).toMatchObject({ indexStatus: " ", workingStatus: "M" });
    expect(r.staged).toHaveLength(0);
  });

  it("parses a file with both staged + unstaged changes (MM)", () => {
    const r = parsePorcelainZ("MM src/a.ts\0", ROOT);
    expect(r.staged).toHaveLength(1);
    expect(r.unstaged).toHaveLength(1);
  });

  it("parses multiple entries", () => {
    const input = "M  a.ts\0?? b.txt\0 D c.md\0";
    const r = parsePorcelainZ(input, ROOT);
    expect(r.staged.map((e) => e.relPath)).toEqual(["a.ts"]);
    expect(r.untracked.map((e) => e.relPath)).toEqual(["b.txt"]);
    expect(r.unstaged.map((e) => e.relPath)).toEqual(["c.md"]);
  });

  it("handles renames (R) by consuming the original path", () => {
    // git emits: "R  new\0old\0" for a renamed-and-staged file
    const input = "R  new.ts\0old.ts\0?? after.txt\0";
    const r = parsePorcelainZ(input, ROOT);
    expect(r.staged.map((e) => e.relPath)).toEqual(["new.ts"]);
    expect(r.untracked.map((e) => e.relPath)).toEqual(["after.txt"]);
  });

  it("handles copies (C) by consuming the original path", () => {
    const input = "C  copy.ts\0src.ts\0";
    const r = parsePorcelainZ(input, ROOT);
    expect(r.staged.map((e) => e.relPath)).toEqual(["copy.ts"]);
  });

  it("handles paths with spaces (no quoting under -z)", () => {
    const r = parsePorcelainZ("?? has space.txt\0", ROOT);
    expect(r.untracked).toHaveLength(1);
    expect(r.untracked[0]!.relPath).toBe("has space.txt");
  });

  it("resolves paths against the repo root", () => {
    const r = parsePorcelainZ("M  src/a.ts\0", "/repo");
    expect(r.staged[0]!.path).toBe("/repo/src/a.ts");
  });

  it("returns deleted-in-working-tree as unstaged", () => {
    const r = parsePorcelainZ(" D gone.ts\0", ROOT);
    expect(r.unstaged).toHaveLength(1);
    expect(r.unstaged[0]!.workingStatus).toBe("D");
  });
});
