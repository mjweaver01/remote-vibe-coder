import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// listPastSessions hardcodes ~/.claude/projects, so we point HOME at a temp dir
// before importing the module.
let tmpHome: string;
let listPastSessions: typeof import("./history.ts").listPastSessions;

beforeAll(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "rvc-home-"));
  vi.stubEnv("HOME", tmpHome);
  ({ listPastSessions } = await import("./history.ts"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(tmpHome, { recursive: true, force: true });
});

function encodeCwd(p: string): string {
  return p.replace(/\//g, "-");
}

async function seedSession(cwd: string, id: string, lines: object[]): Promise<string> {
  const dir = join(tmpHome, ".claude", "projects", encodeCwd(cwd));
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n"));
  return file;
}

describe("listPastSessions", () => {
  it("returns empty when directory does not exist", async () => {
    const r = await listPastSessions("/nope/does/not/exist");
    expect(r).toEqual([]);
  });

  it("extracts a string user message preview", async () => {
    const cwd = "/Users/me/proj-a";
    await seedSession(cwd, "abc", [
      { type: "user", message: { role: "user", content: "hello world" } },
    ]);
    const r = await listPastSessions(cwd);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("abc");
    expect(r[0]!.preview).toBe("hello world");
  });

  it("extracts an array-of-content user message preview", async () => {
    const cwd = "/Users/me/proj-b";
    await seedSession(cwd, "def", [
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      },
    ]);
    const r = await listPastSessions(cwd);
    expect(r[0]!.preview).toBe("first second");
  });

  it("skips lines that fail to JSON.parse without throwing", async () => {
    const cwd = "/Users/me/proj-c";
    const dir = join(tmpHome, ".claude", "projects", encodeCwd(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "x.jsonl"),
      "not json\n" + JSON.stringify({ type: "user", message: { role: "user", content: "ok" } })
    );
    const r = await listPastSessions(cwd);
    expect(r[0]!.preview).toBe("ok");
  });

  it("returns a placeholder when no user message exists", async () => {
    const cwd = "/Users/me/proj-d";
    await seedSession(cwd, "y", [{ type: "system", message: { role: "system", content: "boot" } }]);
    const r = await listPastSessions(cwd);
    expect(r[0]!.preview).toContain("no user message");
  });

  it("sorts newest first", async () => {
    const cwd = "/Users/me/proj-e";
    const a = await seedSession(cwd, "older", [
      { type: "user", message: { role: "user", content: "a" } },
    ]);
    const b = await seedSession(cwd, "newer", [
      { type: "user", message: { role: "user", content: "b" } },
    ]);
    // Bump mtime on the second file
    const { utimes } = await import("node:fs/promises");
    const now = Date.now() / 1000;
    await utimes(a, now - 100, now - 100);
    await utimes(b, now, now);
    const r = await listPastSessions(cwd);
    expect(r.map((s) => s.id)).toEqual(["newer", "older"]);
  });
});
