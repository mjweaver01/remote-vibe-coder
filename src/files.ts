import { readdir, stat } from 'node:fs/promises';
import { resolve, sep, basename } from 'node:path';
import { homedir } from 'node:os';
import type { FolderEntry } from './types.ts';

export function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) return p.replace('~', homedir());
  return p;
}

export function isPathInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

export async function listFolders(absPath: string, root: string): Promise<{
  cwd: string;
  cwdLabel: string;
  parent: string | null;
  entries: FolderEntry[];
}> {
  const cwd = resolve(absPath);
  if (!isPathInside(cwd, root)) {
    throw new Error(`path is outside the allowed root`);
  }
  const dirents = await readdir(cwd, { withFileTypes: true });
  const entries: FolderEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue;
    const full = resolve(cwd, d.name);
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      try {
        isDir = (await stat(full)).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDir) continue;
    entries.push({ name: d.name, path: full, isDir: true });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const parent = cwd === resolve(root) ? null : resolve(cwd, '..');
  return {
    cwd,
    cwdLabel: cwd === resolve(root) ? `~/${basename(root)}` : cwd.replace(root, `~/${basename(root)}`),
    parent: parent && isPathInside(parent, root) ? parent : null,
    entries,
  };
}
