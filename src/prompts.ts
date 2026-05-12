// Heuristic detector for "Claude is waiting for input."
// Run against the tail of the ring buffer after the PTY goes idle.
// We strip ANSI escapes first, then look for the visual cues Claude Code's
// permission/menu prompts emit: the "❯" cursor on a numbered option, an
// explicit question, or "Do you want…" phrasing.

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const CR_RE = /\r(?!\n)/g;

const PROMPT_PATTERNS: Array<{ name: string; test: (text: string) => boolean }> = [
  {
    name: "menu-cursor",
    // ❯ 1. … or ❯ 1) … — Claude's permission prompt cursor.
    test: (t) => /❯\s*\d+[.)]\s+\S/.test(t),
  },
  {
    name: "do-you-want",
    test: (t) => /\bDo you want\b/i.test(t),
  },
  {
    name: "yn-paren",
    test: (t) => /\(y\/n\)\s*$/im.test(t) || /\[y\/n\]\s*$/im.test(t),
  },
  {
    name: "numbered-options",
    // Three or more "  1. …", "  2. …" lines in close succession.
    test: (t) => {
      const m = t.match(/^\s*\d+[.)]\s+\S/gm);
      return !!m && m.length >= 3;
    },
  },
  {
    name: "press-to-continue",
    test: (t) => /press\s+(<?[A-Za-z\-+]+>?)\s+to\b/i.test(t),
  },
  {
    name: "input-box-idle",
    // Claude Code's idle prompt — a `❯` line between horizontal-rule borders
    // with the "?for shortcuts" status line below it. The status line is the
    // strongest signal since it only renders when Claude is waiting for input.
    test: (t) => {
      const tail = t.split("\n").slice(-20).join("\n");
      return /─{6,}/.test(tail) && /\?\s*for\s*shortcuts/i.test(tail);
    },
  },
];

export interface PromptDetection {
  matched: boolean;
  pattern?: string;
  /** A short snippet (≤140 chars) suitable for notification body. */
  preview?: string;
}

export function detectPrompt(rawTail: string): PromptDetection {
  const clean = rawTail.replace(ANSI_RE, "").replace(CR_RE, "\n");
  for (const p of PROMPT_PATTERNS) {
    if (p.test(clean)) {
      return { matched: true, pattern: p.name, preview: lastNonEmptyLine(clean) };
    }
  }
  return { matched: false };
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i]!.trim();
    if (s) return s.length > 140 ? s.slice(0, 137) + "…" : s;
  }
  return "";
}
