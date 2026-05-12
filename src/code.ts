// File reading + git diff for the FilesPanel UI.
// All operations are sandboxed under --root.

import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { resolve, join, sep, relative, basename } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".svelte-kit",
  ".vercel",
  ".output",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
]);

function isPathInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

export interface TreeEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export async function listTree(
  absPath: string,
  sandboxRoot: string
): Promise<{
  cwd: string;
  parent: string | null;
  entries: TreeEntry[];
}> {
  const cwd = resolve(absPath);
  if (!isPathInside(cwd, sandboxRoot)) throw new Error("path outside sandbox");
  const dirents = await readdir(cwd, { withFileTypes: true });
  const entries: TreeEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith(".") && d.name !== ".gitignore" && d.name !== ".env.example") continue;
    if (SKIP_DIRS.has(d.name)) continue;
    const full = join(cwd, d.name);
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      try {
        isDir = (await stat(full)).isDirectory();
      } catch {
        continue;
      }
    }
    entries.push({ name: d.name, path: full, isDir });
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const parent = cwd === resolve(sandboxRoot) ? null : resolve(cwd, "..");
  return {
    cwd,
    parent: parent && isPathInside(parent, sandboxRoot) ? parent : null,
    entries,
  };
}

export async function readFileSafe(
  absPath: string,
  sandboxRoot: string
): Promise<{
  path: string;
  name: string;
  content: string;
  bytes: number;
  truncated: boolean;
  binary: boolean;
}> {
  const file = resolve(absPath);
  if (!isPathInside(file, sandboxRoot)) throw new Error("path outside sandbox");
  const s = await stat(file);
  if (!s.isFile()) throw new Error("not a file");

  const cap = Math.min(s.size, MAX_FILE_BYTES);
  const buf = Buffer.alloc(cap);
  const fh = await import("node:fs/promises").then((m) => m.open(file, "r"));
  try {
    let filled = 0;
    while (filled < cap) {
      const { bytesRead } = await fh.read(buf, filled, cap - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
  } finally {
    await fh.close();
  }

  const binary = looksBinary(buf);
  const content = binary ? "" : buf.toString("utf8");

  return {
    path: file,
    name: basename(file),
    content,
    bytes: s.size,
    truncated: s.size > MAX_FILE_BYTES,
    binary,
  };
}

function looksBinary(buf: Buffer): boolean {
  // UTF-16 text has NUL in every other byte; detect that first and treat as text.
  const limit = Math.min(buf.length, 8192);
  if (limit >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return false; // UTF-16 LE BOM
    if (buf[0] === 0xfe && buf[1] === 0xff) return false; // UTF-16 BE BOM
  }
  // Otherwise, classify on the fraction of non-printable, non-NUL control bytes.
  let suspicious = 0;
  for (let i = 0; i < limit; i++) {
    const b = buf[i]!;
    if (b === 0) return true;
    // Allow common whitespace controls; flag the rest of C0.
    if (b < 0x09 || (b > 0x0d && b < 0x20)) suspicious++;
  }
  return limit > 0 && suspicious / limit > 0.3;
}

export async function gitDiff(
  absPath: string,
  sandboxRoot: string
): Promise<{
  path: string;
  original: string;
  modified: string;
  staged: boolean;
  inGit: boolean;
  isUntracked: boolean;
}> {
  const file = resolve(absPath);
  if (!isPathInside(file, sandboxRoot)) throw new Error("path outside sandbox");

  // Find git root
  const root = await findGitRoot(file);
  if (!root) {
    // Not in a repo — fall back to current contents
    const cur = await readFileSafe(file, sandboxRoot);
    return {
      path: file,
      original: "",
      modified: cur.binary ? "(binary file)" : cur.content,
      staged: false,
      inGit: false,
      isUntracked: false,
    };
  }

  const rel = relative(root, file);

  // Try `git show HEAD:<rel>` for the base. If that fails, file is new.
  let original = "";
  let isUntracked = false;
  try {
    const { stdout } = await execFileP("git", ["show", `HEAD:${rel}`], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    original = stdout;
  } catch (err) {
    if (err instanceof Error && err.message.includes("maxBuffer")) {
      original = "(diff too large to display)";
    } else {
      isUntracked = true;
    }
  }

  const cur = await readFileSafe(file, sandboxRoot);
  const modified = cur.binary ? "(binary file)" : cur.content;

  return { path: file, original, modified, staged: false, inGit: true, isUntracked };
}

export async function findGitRoot(start: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "--show-toplevel"], {
      cwd: (await stat(start)).isDirectory() ? start : resolve(start, ".."),
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
