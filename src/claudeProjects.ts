// Shared helpers for reading Claude Code's per-cwd conversation log directory.
// Layout: ~/.claude/projects/<cwd-with-slashes-as-dashes>/<conversation-id>.jsonl

import { readdir, stat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROJECTS_DIR = join(homedir(), ".claude", "projects");

export function projectsDirFor(cwd: string): string {
  return join(PROJECTS_DIR, cwd.replace(/\//g, "-"));
}

export async function listConversationFiles(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(projectsDirFor(cwd));
    return entries.filter((n) => n.endsWith(".jsonl"));
  } catch {
    return [];
  }
}

export interface ConversationFile {
  id: string;
  mtime: number;
  sizeBytes: number;
}

export async function listConversations(cwd: string): Promise<ConversationFile[]> {
  const dir = projectsDirFor(cwd);
  const names = await listConversationFiles(cwd);
  const out: ConversationFile[] = [];
  await Promise.all(
    names.map(async (name) => {
      try {
        const s = await stat(join(dir, name));
        out.push({
          id: name.replace(/\.jsonl$/, ""),
          mtime: s.mtimeMs,
          sizeBytes: s.size,
        });
      } catch {
        // skip
      }
    })
  );
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export async function mostRecentConversationId(cwd: string): Promise<string | null> {
  const list = await listConversations(cwd);
  return list[0]?.id ?? null;
}

/**
 * Read the title for a conversation. Prefers Claude Code's `ai-title` entry
 * (the same string the `claude` CLI's session picker shows) and falls back to
 * the first user message if no `ai-title` has been written yet.
 *
 * `ai-title` is rewritten as Claude refines its summary; the *last* one in the
 * file is canonical, so we scan from the end.
 */
export async function readConversationTitle(cwd: string, conversationId: string): Promise<string> {
  const filePath = join(projectsDirFor(cwd), `${conversationId}.jsonl`);
  let fh;
  try {
    fh = await open(filePath, "r");
  } catch {
    return "";
  }
  try {
    const { size } = await fh.stat();
    if (size === 0) return "";
    const chunkSize = 64 * 1024;
    let pos = Math.max(0, size - chunkSize);
    let trailing = "";
    while (pos >= 0) {
      const len = Math.min(chunkSize, size - pos);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, pos);
      const text = buf.toString("utf8") + trailing;
      const lines = text.split("\n");
      trailing = pos > 0 ? (lines.shift() ?? "") : "";
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!.trim();
        if (!line || !line.includes('"ai-title"')) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "ai-title" && typeof evt.aiTitle === "string" && evt.aiTitle) {
            const clean = sanitizePrompt(evt.aiTitle) || evt.aiTitle.trim();
            if (clean) return clean.slice(0, 200);
          }
        } catch {
          // not JSON — keep scanning
        }
      }
      if (pos === 0) break;
      pos = Math.max(0, pos - chunkSize);
    }
  } finally {
    await fh.close();
  }
  return readFirstUserMessage(cwd, conversationId);
}

export async function readFirstUserMessage(cwd: string, conversationId: string): Promise<string> {
  const filePath = join(projectsDirFor(cwd), `${conversationId}.jsonl`);
  let fh;
  try {
    fh = await open(filePath, "r");
  } catch {
    return "";
  }
  try {
    const chunk = Buffer.alloc(64 * 1024);
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
      if (evt.type !== "user" || evt.message?.role !== "user") continue;
      const raw = extractText(evt.message.content);
      const cleaned = sanitizePrompt(raw);
      if (cleaned) return cleaned.slice(0, 200);
    }
    return "";
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
    return parts.join(" ");
  }
  return "";
}

/**
 * Strip Claude Code's wrapper tags (slash-command framing, IDE-injected context,
 * system reminders, hook output) so the title reflects the actual human prompt.
 *
 * If a slash-command name is present, surface it (e.g. "/init") rather than
 * returning empty.
 */
function sanitizePrompt(input: string): string {
  if (!input) return "";

  // Surface slash-command name before stripping, so "/init" survives.
  const slash = input.match(/<command-name>\s*([^<\s]+)\s*<\/command-name>/);

  // Strip any Claude Code wrapper tag along with its content. The set of
  // wrappers grows over time (command-*, local-command-*, ide_*, bash-*,
  // system-reminder, user-prompt-submit-hook, local-command-caveat, …), so
  // match the shape generically rather than maintaining a whitelist.
  const stripped = input
    .replace(/<([a-z][a-z0-9_-]*)>[\s\S]*?<\/\1>/gi, "")
    // Self-closing or orphan opens (e.g. injected metadata)
    .replace(/<\/?[a-z][a-z0-9_-]*\s*\/?>/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped) return stripped;
  if (slash) return `/${slash[1]}`;
  return "";
}
