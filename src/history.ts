// Reads Claude Code's per-cwd session history from ~/.claude/projects/<encoded>/*.jsonl

import { listConversations, readConversationTitle } from "./claudeProjects";

export interface PastSession {
  id: string;
  preview: string;
  mtime: number;
  sizeBytes: number;
}

export async function listPastSessions(cwd: string): Promise<PastSession[]> {
  const convs = await listConversations(cwd);
  const out: PastSession[] = await Promise.all(
    convs.map(async (c) => ({
      id: c.id,
      preview: (await readConversationTitle(cwd, c.id)) || "(no user message found)",
      mtime: c.mtime,
      sizeBytes: c.sizeBytes,
    }))
  );
  return out;
}
