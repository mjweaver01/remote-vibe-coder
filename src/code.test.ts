import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTree, readFileSafe, gitDiff } from "./code.ts";

const execFileP = promisify(execFile);

describe("listTree", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rvc-tree-"));
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "lib"));
    await writeFile(join(root, "README.md"), "hi");
    await writeFile(join(root, ".gitignore"), "node_modules\n");
    await writeFile(join(root, ".env.local"), "secret");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("skips ignored dirs and dotfiles, keeps .gitignore", async () => {
    const r = await listTree(root, root);
    const names = r.entries.map((e) => e.name);
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".git");
    expect(names).not.toContain(".env.local");
    expect(names).toContain(".gitignore");
    expect(names).toContain("README.md");
    expect(names).toContain("src");
  });

  it("sorts directories before files, then alphabetically", async () => {
    const r = await listTree(root, root);
    const names = r.entries.map((e) => e.name);
    // dirs first, sorted: lib, src; then files: .gitignore, README.md
    expect(names).toEqual(["lib", "src", ".gitignore", "README.md"]);
  });

  it("returns null parent at the sandbox root", async () => {
    const r = await listTree(root, root);
    expect(r.parent).toBeNull();
  });

  it("returns parent for a nested dir", async () => {
    const r = await listTree(join(root, "src"), root);
    expect(r.parent).toBe(root);
  });

  it("rejects paths outside the sandbox", async () => {
    await expect(listTree("/", root)).rejects.toThrow(/sandbox/);
  });

  it("rejects path traversal", async () => {
    await expect(listTree(join(root, "..", ".."), root)).rejects.toThrow(/sandbox/);
  });
});

describe("readFileSafe", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rvc-read-"));
    await writeFile(join(root, "hello.txt"), "hello world");
    // A 2 MB file to trigger truncation
    await writeFile(join(root, "big.txt"), "a".repeat(2 * 1024 * 1024));
    // Real binary: a PNG header + random bytes (with NUL)
    const bin = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    await writeFile(join(root, "image.png"), bin);
    // UTF-16 LE BOM file — must be classified as text despite many zero bytes
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hi", "utf16le")]);
    await writeFile(join(root, "u16.txt"), utf16);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads a small text file", async () => {
    const r = await readFileSafe(join(root, "hello.txt"), root);
    expect(r.content).toBe("hello world");
    expect(r.binary).toBe(false);
    expect(r.truncated).toBe(false);
    expect(r.bytes).toBe(11);
    expect(r.name).toBe("hello.txt");
  });

  it("flags truncated when file exceeds 1 MB cap", async () => {
    const r = await readFileSafe(join(root, "big.txt"), root);
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBe(2 * 1024 * 1024);
    expect(r.content.length).toBe(1024 * 1024);
  });

  it("detects binary files and returns empty content", async () => {
    const r = await readFileSafe(join(root, "image.png"), root);
    expect(r.binary).toBe(true);
    expect(r.content).toBe("");
  });

  it("treats UTF-16 BOM files as text, not binary", async () => {
    const r = await readFileSafe(join(root, "u16.txt"), root);
    expect(r.binary).toBe(false);
  });

  it("rejects paths outside the sandbox", async () => {
    await expect(readFileSafe("/etc/passwd", root)).rejects.toThrow(/sandbox/);
  });

  it("rejects directories", async () => {
    await expect(readFileSafe(root, root)).rejects.toThrow(/not a file/);
  });
});

describe("gitDiff", () => {
  let root: string;
  let repo: string;
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "rvc-diff-")));
    repo = join(root, "repo");
    await mkdir(repo);
    const opts = { cwd: repo };
    await execFileP("git", ["init", "-q", "-b", "main"], opts);
    await execFileP("git", ["config", "user.email", "t@t"], opts);
    await execFileP("git", ["config", "user.name", "t"], opts);
    await execFileP("git", ["config", "commit.gpgsign", "false"], opts);
    await writeFile(join(repo, "a.txt"), "v1\n");
    await execFileP("git", ["add", "."], opts);
    await execFileP("git", ["commit", "-q", "-m", "init"], opts);
    await writeFile(join(repo, "a.txt"), "v2\n");
    await writeFile(join(repo, "new.txt"), "fresh\n");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns HEAD vs working tree for tracked modified files", async () => {
    const r = await gitDiff(join(repo, "a.txt"), root);
    expect(r.inGit).toBe(true);
    expect(r.isUntracked).toBe(false);
    expect(r.original).toBe("v1\n");
    expect(r.modified).toBe("v2\n");
  });

  it("marks untracked files with empty original", async () => {
    const r = await gitDiff(join(repo, "new.txt"), root);
    expect(r.inGit).toBe(true);
    expect(r.isUntracked).toBe(true);
    expect(r.original).toBe("");
    expect(r.modified).toBe("fresh\n");
  });

  it("falls back to current contents when file is not in a git repo", async () => {
    const stray = join(root, "stray.txt");
    await writeFile(stray, "loose\n");
    const r = await gitDiff(stray, root);
    expect(r.inGit).toBe(false);
    expect(r.original).toBe("");
    expect(r.modified).toBe("loose\n");
  });

  it("rejects paths outside the sandbox", async () => {
    await expect(gitDiff("/etc/hosts", root)).rejects.toThrow(/sandbox/);
  });
});
