import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function freshModule(fakeHome: string) {
  vi.resetModules();
  process.env.HOME = fakeHome;
  return await import("./claudeProjects.ts");
}

function jsonl(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

describe("claudeProjects", () => {
  let scratch: string;
  let fakeHome: string;
  const realHome = process.env.HOME;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "rvc-claudeproj-"));
    fakeHome = join(scratch, "home");
    await mkdir(join(fakeHome, ".claude", "projects"), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = realHome;
    await rm(scratch, { recursive: true, force: true });
  });

  it("projectsDirFor translates slashes to dashes and joins under HOME/.claude/projects", async () => {
    const { projectsDirFor, PROJECTS_DIR } = await freshModule(fakeHome);
    expect(PROJECTS_DIR).toBe(join(fakeHome, ".claude", "projects"));
    expect(projectsDirFor("/Users/me/code")).toBe(
      join(fakeHome, ".claude", "projects", "-Users-me-code")
    );
  });

  it("listConversationFiles returns [] when the dir does not exist", async () => {
    const { listConversationFiles } = await freshModule(fakeHome);
    const files = await listConversationFiles("/nope");
    expect(files).toEqual([]);
  });

  it("listConversations returns ids sorted by mtime desc", async () => {
    const cwd = "/proj/x";
    const dir = join(fakeHome, ".claude", "projects", "-proj-x");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "older.jsonl"), "{}\n");
    await writeFile(join(dir, "newer.jsonl"), "{}\n");
    await writeFile(join(dir, "not-a-conv.txt"), "ignore me");
    // Force mtimes: older has a past timestamp
    const now = Date.now() / 1000;
    await utimes(join(dir, "older.jsonl"), now - 1000, now - 1000);
    await utimes(join(dir, "newer.jsonl"), now, now);

    const { listConversations, mostRecentConversationId } = await freshModule(fakeHome);
    const list = await listConversations(cwd);
    expect(list.map((c) => c.id)).toEqual(["newer", "older"]);
    expect(await mostRecentConversationId(cwd)).toBe("newer");
  });

  it("readFirstUserMessage returns '' when the file does not exist", async () => {
    const { readFirstUserMessage } = await freshModule(fakeHome);
    expect(await readFirstUserMessage("/missing/cwd", "abc")).toBe("");
  });

  it("readFirstUserMessage finds the first user-role text message and skips non-user events", async () => {
    const cwd = "/p";
    const dir = join(fakeHome, ".claude", "projects", "-p");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "conv.jsonl"),
      jsonl([
        { type: "summary", summary: "ignored" },
        { type: "assistant", message: { role: "assistant", content: "hello back" } },
        { type: "user", message: { role: "user", content: "hello there" } },
        { type: "user", message: { role: "user", content: "second message" } },
      ])
    );
    const { readFirstUserMessage } = await freshModule(fakeHome);
    expect(await readFirstUserMessage(cwd, "conv")).toBe("hello there");
  });

  it("handles array content blocks and concatenates text parts", async () => {
    const cwd = "/p";
    const dir = join(fakeHome, ".claude", "projects", "-p");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "conv.jsonl"),
      jsonl([
        {
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "text", text: "part one" },
              { type: "image", source: {} },
              { type: "text", text: "part two" },
            ],
          },
        },
      ])
    );
    const { readFirstUserMessage } = await freshModule(fakeHome);
    expect(await readFirstUserMessage(cwd, "conv")).toBe("part one part two");
  });

  it("strips wrapper tags (system-reminder, command-message, ide_*)", async () => {
    const cwd = "/p";
    const dir = join(fakeHome, ".claude", "projects", "-p");
    await mkdir(dir, { recursive: true });
    const wrapped =
      "<system-reminder>ignore me</system-reminder>" +
      "<ide_selection>file.ts:1</ide_selection>" +
      "real prompt content";
    await writeFile(
      join(dir, "conv.jsonl"),
      jsonl([{ type: "user", message: { role: "user", content: wrapped } }])
    );
    const { readFirstUserMessage } = await freshModule(fakeHome);
    expect(await readFirstUserMessage(cwd, "conv")).toBe("real prompt content");
  });

  it("surfaces slash-command name when the wrapped content would otherwise be empty", async () => {
    const cwd = "/p";
    const dir = join(fakeHome, ".claude", "projects", "-p");
    await mkdir(dir, { recursive: true });
    const wrapped =
      "<command-name>init</command-name><command-message>Initialize</command-message>";
    await writeFile(
      join(dir, "conv.jsonl"),
      jsonl([{ type: "user", message: { role: "user", content: wrapped } }])
    );
    const { readFirstUserMessage } = await freshModule(fakeHome);
    expect(await readFirstUserMessage(cwd, "conv")).toBe("/init");
  });

  it("skips malformed JSON lines without crashing", async () => {
    const cwd = "/p";
    const dir = join(fakeHome, ".claude", "projects", "-p");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "conv.jsonl"),
      "this is not json\n" +
        JSON.stringify({ type: "user", message: { role: "user", content: "ok" } }) +
        "\n"
    );
    const { readFirstUserMessage } = await freshModule(fakeHome);
    expect(await readFirstUserMessage(cwd, "conv")).toBe("ok");
  });

  it("caps the result at 200 chars", async () => {
    const cwd = "/p";
    const dir = join(fakeHome, ".claude", "projects", "-p");
    await mkdir(dir, { recursive: true });
    const long = "x".repeat(500);
    await writeFile(
      join(dir, "conv.jsonl"),
      jsonl([{ type: "user", message: { role: "user", content: long } }])
    );
    const { readFirstUserMessage } = await freshModule(fakeHome);
    const out = await readFirstUserMessage(cwd, "conv");
    expect(out.length).toBe(200);
  });
});
