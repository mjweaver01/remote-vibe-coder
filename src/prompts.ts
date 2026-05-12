// Heuristic detector for "Claude is waiting for input."
// Run against the tail of the ring buffer after the PTY goes idle.
// We strip ANSI escapes first, then look for the visual cues Claude Code's
// permission/menu prompts emit: the "❯" cursor on a numbered option, an
// explicit question, or "Do you want…" phrasing.

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const CR_RE = /\r(?!\n)/g;

// Markers Claude Code renders just above the input box while it is mid-turn.
// `⏺` is the tool-call bullet ("⏺ Bash …"). Words like "Pondering", "Working",
// "Thinking", "Generating" prefix the model-thinking spinner. Star-style and
// circle-style glyphs are the rotating spinner indicators themselves.
const THINKING_RE =
  /⏺|✶|✷|✸|✦|⋆|◐|◑|◒|◓|\bPondering\b|\bThinking\b|\bWorking\b|\bGenerating\b|\bReading\b|\bWriting\b|\bRunning\b|\bSearching\b|\bLoading\b/i;

interface Pattern {
  name: string;
  test: (text: string) => boolean;
  preview?: (text: string) => string;
}

const PROMPT_PATTERNS: Pattern[] = [
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
    // with the "?for shortcuts" status line below it. We additionally require
    // that no "thinking spinner" is visible just above the input box, because
    // that area renders activity like "* Pondering" / "⏺ Bash …" / progress
    // glyphs while Claude is mid-turn. Without this check, a long tool call
    // or network pause can look identical to "done."
    test: (t) => {
      const tail = t.split("\n").slice(-20).join("\n");
      if (!/─{6,}/.test(tail)) return false;
      if (!/\?\s*for\s*shortcuts/i.test(tail)) return false;
      // Inspect the few lines immediately above the first border line.
      const lines = tail.split("\n");
      const firstBorder = lines.findIndex((l) => /─{6,}/.test(l));
      const above = lines.slice(Math.max(0, firstBorder - 4), firstBorder).join("\n");
      if (THINKING_RE.test(above)) return false;
      return true;
    },
    preview: () => "Claude finished responding",
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
      const preview = p.preview ? p.preview(clean) : lastNonEmptyLine(clean);
      return { matched: true, pattern: p.name, preview };
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
