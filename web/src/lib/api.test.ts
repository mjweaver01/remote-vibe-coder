import { describe, it, expect, beforeEach, vi } from "vitest";

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetchOnce(body: unknown, init: ResponseInit = { status: 200 }): FetchMock {
  const fn = vi.fn(async () => {
    const json = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(json, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

async function freshApi() {
  vi.resetModules();
  return await import("./api.ts");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("fetchFolders", () => {
  it("calls /api/folders with no query when path omitted", async () => {
    const fn = mockFetchOnce({ cwd: "/", cwdLabel: "/", parent: null, entries: [] });
    const { fetchFolders } = await freshApi();
    await fetchFolders();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(String(fn.mock.calls[0]![0])).toBe("/api/folders");
  });

  it("URL-encodes the path parameter", async () => {
    const fn = mockFetchOnce({ cwd: "/x", cwdLabel: "/x", parent: null, entries: [] });
    const { fetchFolders } = await freshApi();
    await fetchFolders("/Users/me/with space");
    expect(String(fn.mock.calls[0]![0])).toContain("path=%2FUsers%2Fme%2Fwith%20space");
  });

  it("appends the token from localStorage when present", async () => {
    localStorage.setItem("rvc.token", "T");
    const fn = mockFetchOnce({ cwd: "/", cwdLabel: "/", parent: null, entries: [] });
    const { fetchFolders } = await freshApi();
    await fetchFolders();
    expect(String(fn.mock.calls[0]![0])).toContain("token=T");
  });
});

describe("error handling", () => {
  it("throws ApiError with status and the server-supplied error message", async () => {
    mockFetchOnce({ error: "path outside sandbox" }, { status: 400 });
    const { fetchFile } = await freshApi();
    await expect(fetchFile("/etc/passwd")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "path outside sandbox",
    });
  });

  it("surfaces the raw text body when the response is not JSON", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("internal kaboom", { status: 500 })
    ) as unknown as typeof fetch;
    const { fetchConfig } = await freshApi();
    await expect(fetchConfig()).rejects.toMatchObject({
      status: 500,
      message: "internal kaboom",
    });
  });

  it("falls back to `HTTP <status>` when there is no body and no error field", async () => {
    mockFetchOnce({}, { status: 404 });
    const { fetchConfig } = await freshApi();
    await expect(fetchConfig()).rejects.toMatchObject({
      status: 404,
      message: "HTTP 404",
    });
  });

  it("ApiError is an Error subclass", async () => {
    mockFetchOnce({ error: "nope" }, { status: 400 });
    const { fetchFile, ApiError } = await freshApi();
    try {
      await fetchFile("/x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(ApiError);
    }
  });
});

describe("AbortSignal", () => {
  it("forwards the signal to fetch", async () => {
    const fn = mockFetchOnce({ cwd: "/", cwdLabel: "/", parent: null, entries: [] });
    const { fetchFolders } = await freshApi();
    const controller = new AbortController();
    await fetchFolders(undefined, controller.signal);
    const init = fn.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });
});

describe("post*", () => {
  it("postGitStage sends JSON with content-type and the files body", async () => {
    const fn = mockFetchOnce({ ok: true });
    const { postGitStage } = await freshApi();
    await postGitStage(["a.ts", "b.ts"]);
    const [url, init] = fn.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/git/stage");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ files: ["a.ts", "b.ts"] });
  });

  it("postGitCommit posts cwd and message and returns the hash", async () => {
    const fn = mockFetchOnce({ hash: "deadbeef" });
    const { postGitCommit } = await freshApi();
    const r = await postGitCommit("/repo", "fix: thing");
    expect(r).toEqual({ hash: "deadbeef" });
    const [, init] = fn.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ cwd: "/repo", message: "fix: thing" });
  });

  it("throws ApiError on non-2xx POST responses", async () => {
    mockFetchOnce({ error: "nothing staged" }, { status: 400 });
    const { postGitCommit } = await freshApi();
    await expect(postGitCommit("/r", "m")).rejects.toMatchObject({
      status: 400,
      message: "nothing staged",
    });
  });
});
