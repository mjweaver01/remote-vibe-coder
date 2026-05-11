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

export async function readFirstUserMessage(
  cwd: string,
  conversationId: string
): Promise<string> {
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

  // Drop known wrapper tags along with their content.
  const stripped = input
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<command-stdout>[\s\S]*?<\/command-stdout>/g, "")
    .replace(/<command-stderr>[\s\S]*?<\/command-stderr>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, "")
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, "")
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "")
    .replace(/<ide_diagnostics>[\s\S]*?<\/ide_diagnostics>/g, "")
    .replace(/<bash-input>[\s\S]*?<\/bash-input>/g, "")
    .replace(/<bash-stdout>[\s\S]*?<\/bash-stdout>/g, "")
    .replace(/<bash-stderr>[\s\S]*?<\/bash-stderr>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped) return stripped;
  if (slash) return `/${slash[1]}`;
  return "";
}
