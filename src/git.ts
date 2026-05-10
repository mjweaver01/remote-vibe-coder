import { execFile } from "node:child_process";
import { resolve, sep } from "node:path";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

function isPathInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

export interface GitFileStatus {
  path: string; // absolute path
  relPath: string; // relative to git root
  indexStatus: string; // first char of porcelain status
  workingStatus: string; // second char of porcelain status
}

export interface GitStatusResult {
  inGit: boolean;
  root: string | null;
  branch: string | null;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

async function findGitRoot(cwd: string): Promise<string | null> {
  try {
    const dir = (await stat(cwd)).isDirectory() ? cwd : resolve(cwd, "..");
    const { stdout } = await execFileP("git", ["rev-parse", "--show-toplevel"], { cwd: dir });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getCurrentBranch(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function gitStatus(cwd: string, sandboxRoot: string): Promise<GitStatusResult> {
  const dir = resolve(cwd);
  if (!isPathInside(dir, sandboxRoot)) throw new Error("path outside sandbox");

  const root = await findGitRoot(dir);
  if (!root) return { inGit: false, root: null, branch: null, staged: [], unstaged: [], untracked: [] };

  const [branch, statusOut] = await Promise.all([
    getCurrentBranch(root),
    execFileP("git", ["status", "--porcelain=v1", "-z"], { cwd: root, maxBuffer: 4 * 1024 * 1024 }),
  ]);

  const staged: GitFileStatus[] = [];
  const unstaged: GitFileStatus[] = [];
  const untracked: GitFileStatus[] = [];

  // Porcelain v1 with -z: entries are NUL-separated, each entry is "XY path" (or "XY orig\0new" for renames)
  const raw = statusOut.stdout;
  let i = 0;
  while (i < raw.length) {
    if (raw.length - i < 3) break;
    const X = raw[i] ?? " ";
    const Y = raw[i + 1] ?? " ";
    i += 3; // skip "XY "
    const end = raw.indexOf("\0", i);
    const relPath = end === -1 ? raw.slice(i) : raw.slice(i, end);
    i = end === -1 ? raw.length : end + 1;

    // For renames, there's an additional NUL-terminated original path — skip it
    if (X === "R" || X === "C") {
      const end2 = raw.indexOf("\0", i);
      i = end2 === -1 ? raw.length : end2 + 1;
    }

    const absPath = resolve(root, relPath);
    const entry: GitFileStatus = { path: absPath, relPath, indexStatus: X, workingStatus: Y };

    if (X === "?" && Y === "?") {
      untracked.push(entry);
    } else {
      if (X !== " " && X !== "?") staged.push(entry);
      if (Y !== " " && Y !== "?") unstaged.push(entry);
    }
  }

  return { inGit: true, root, branch, staged, unstaged, untracked };
}

export async function gitStage(files: string[], sandboxRoot: string): Promise<void> {
  if (files.length === 0) return;
  const safeFiles = files.map((f) => {
    const p = resolve(f);
    if (!isPathInside(p, sandboxRoot)) throw new Error("path outside sandbox");
    return p;
  });
  // Find git root from first file
  const root = await findGitRoot(safeFiles[0]!);
  if (!root) throw new Error("not a git repository");
  await execFileP("git", ["add", "--", ...safeFiles], { cwd: root });
}

export async function gitUnstage(files: string[], sandboxRoot: string): Promise<void> {
  if (files.length === 0) return;
  const safeFiles = files.map((f) => {
    const p = resolve(f);
    if (!isPathInside(p, sandboxRoot)) throw new Error("path outside sandbox");
    return p;
  });
  const root = await findGitRoot(safeFiles[0]!);
  if (!root) throw new Error("not a git repository");
  await execFileP("git", ["restore", "--staged", "--", ...safeFiles], { cwd: root });
}

export async function gitCommit(cwd: string, message: string, sandboxRoot: string): Promise<{ hash: string }> {
  const dir = resolve(cwd);
  if (!isPathInside(dir, sandboxRoot)) throw new Error("path outside sandbox");
  if (!message.trim()) throw new Error("commit message cannot be empty");
  const root = await findGitRoot(dir);
  if (!root) throw new Error("not a git repository");
  const { stdout } = await execFileP("git", ["commit", "-m", message], { cwd: root });
  // Extract short hash from output like "[main abc1234] message"
  const match = stdout.match(/\[.*?\s+([0-9a-f]+)\]/);
  return { hash: match?.[1] ?? "" };
}
