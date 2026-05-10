// Reads Claude Code's per-cwd session history from ~/.claude/projects/<encoded>/*.jsonl

import { readdir, stat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";

export interface PastSession {
  id: string;
  preview: string;
  mtime: number;
  sizeBytes: number;
}

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

function encodeCwd(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

export async function listPastSessions(cwd: string): Promise<PastSession[]> {
  const dir = join(PROJECTS_DIR, encodeCwd(cwd));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const jsonl = entries.filter((n) => n.endsWith(".jsonl"));
  const out: PastSession[] = [];
  await Promise.all(
    jsonl.map(async (name) => {
      const full = join(dir, name);
      try {
        const s = await stat(full);
        const id = name.replace(/\.jsonl$/, "");
        const preview = await firstUserMessage(full);
        out.push({ id, preview, mtime: s.mtimeMs, sizeBytes: s.size });
      } catch {
        // skip
      }
    })
  );
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

async function firstUserMessage(filePath: string): Promise<string> {
  // Stream-read up to ~32 KB and find the first { type: "user", ... }
  const fh = await open(filePath, "r");
  try {
    const chunk = Buffer.alloc(32 * 1024);
    const { bytesRead } = await fh.read(chunk, 0, chunk.length, 0);
    const text = chunk.subarray(0, bytesRead).toString("utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (evt.type === "user" && evt.message?.role === "user") {
        return extractText(evt.message.content).slice(0, 200);
      }
    }
    return "(no user message found)";
  } finally {
    await fh.close();
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (c && typeof c === "object" && "type" in c) {
        if ((c as any).type === "text" && typeof (c as any).text === "string") {
          parts.push((c as any).text);
        }
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}
