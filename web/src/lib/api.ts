// Typed REST client for the server's /api endpoints.

import type { FolderEntry, PastSessionInfo } from "../../../src/types.ts";
import { withToken } from "./auth.ts";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function json<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(withToken(path), { signal });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// ---------- Folder browser ----------

export interface FolderListing {
  cwd: string;
  cwdLabel: string;
  parent: string | null;
  entries: FolderEntry[];
}

export function fetchFolders(path?: string, signal?: AbortSignal): Promise<FolderListing> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  return json<FolderListing>(`/api/folders${qs}`, signal);
}

// ---------- Code tree ----------

export interface TreeEntry {
  name: string;
  path: string;
  isDir: boolean;
}
export interface TreeListing {
  cwd: string;
  parent: string | null;
  entries: TreeEntry[];
}

export function fetchTree(path: string, signal?: AbortSignal): Promise<TreeListing> {
  return json<TreeListing>(`/api/tree?path=${encodeURIComponent(path)}`, signal);
}

// ---------- File contents ----------

export interface FileContents {
  path: string;
  name: string;
  content: string;
  bytes: number;
  truncated: boolean;
  binary: boolean;
}

export function fetchFile(path: string, signal?: AbortSignal): Promise<FileContents> {
  return json<FileContents>(`/api/file?path=${encodeURIComponent(path)}`, signal);
}

// ---------- Diff ----------

export interface DiffResult {
  path: string;
  original: string;
  modified: string;
  inGit: boolean;
  isUntracked: boolean;
}

export function fetchDiff(path: string, signal?: AbortSignal): Promise<DiffResult> {
  return json<DiffResult>(`/api/diff?path=${encodeURIComponent(path)}`, signal);
}

// ---------- History ----------

export function fetchHistory(
  path: string,
  signal?: AbortSignal
): Promise<{ sessions: PastSessionInfo[] }> {
  return json<{ sessions: PastSessionInfo[] }>(
    `/api/history?path=${encodeURIComponent(path)}`,
    signal
  );
}

// ---------- Server config ----------

export interface ServerConfig {
  root: string;
  hasToken: boolean;
}

export function fetchConfig(signal?: AbortSignal): Promise<ServerConfig> {
  return json<ServerConfig>("/api/config", signal);
}
