import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHome, isPathInside, listFolders } from "./files.ts";

describe("expandHome", () => {
  it("expands ~ alone", () => {
    expect(expandHome("~")).toBe(homedir());
  });

  it("expands ~/foo", () => {
    expect(expandHome("~/Documents")).toBe(join(homedir(), "Documents"));
  });

  it("leaves absolute paths untouched", () => {
    expect(expandHome("/tmp/foo")).toBe("/tmp/foo");
  });

  it("does not expand ~user style", () => {
    expect(expandHome("~root/foo")).toBe("~root/foo");
  });
});

describe("isPathInside", () => {
  it("returns true when child is parent", () => {
    expect(isPathInside("/a/b", "/a/b")).toBe(true);
  });

  it("returns true for nested paths", () => {
    expect(isPathInside("/a/b/c", "/a/b")).toBe(true);
  });

  it("returns false for sibling with shared prefix", () => {
    expect(isPathInside("/a/bc", "/a/b")).toBe(false);
  });

  it("returns false when child is outside parent", () => {
    expect(isPathInside("/x/y", "/a/b")).toBe(false);
  });

  it("rejects traversal", () => {
    expect(isPathInside("/a/b/../../etc", "/a/b")).toBe(false);
  });
});

describe("listFolders", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rvc-files-"));
    await mkdir(join(root, "alpha"));
    await mkdir(join(root, "beta"));
    await mkdir(join(root, ".hidden"));
    await writeFile(join(root, "file.txt"), "ignore me");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists directories only, hides dotfiles, hides regular files", async () => {
    const r = await listFolders(root, root);
    expect(r.entries.map((e) => e.name)).toEqual(["alpha", "beta"]);
    expect(r.parent).toBeNull();
  });

  it("returns parent for nested cwd inside root", async () => {
    const r = await listFolders(join(root, "alpha"), root);
    expect(r.parent).toBe(resolve(root));
  });

  it("rejects paths outside root", async () => {
    await expect(listFolders("/", root)).rejects.toThrow(/outside/);
  });

  it("rejects path traversal", async () => {
    await expect(listFolders(join(root, "..", "..", "etc"), root)).rejects.toThrow(/outside/);
  });

  it("follows symlinks to directories", async () => {
    const real = await mkdtemp(join(tmpdir(), "rvc-link-target-"));
    try {
      await mkdir(join(real, "inner"));
      await symlink(join(real, "inner"), join(root, "link-to-inner"));
      const r = await listFolders(root, root);
      expect(r.entries.map((e) => e.name)).toContain("link-to-inner");
    } finally {
      await rm(real, { recursive: true, force: true });
    }
  });
});
