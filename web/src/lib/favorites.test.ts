import { describe, it, expect, beforeEach } from "vitest";
import { getFavorites, isFavorite, toggleFavorite } from "./favorites.ts";

const KEY = "rvc:favorites";

beforeEach(() => {
  localStorage.clear();
});

describe("getFavorites", () => {
  it("returns [] when nothing is stored", () => {
    expect(getFavorites()).toEqual([]);
  });

  it("returns [] when the stored value is malformed JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(getFavorites()).toEqual([]);
  });

  it("returns the parsed array when present", () => {
    localStorage.setItem(KEY, JSON.stringify([{ path: "/a", label: "A" }]));
    expect(getFavorites()).toEqual([{ path: "/a", label: "A" }]);
  });
});

describe("isFavorite", () => {
  it("returns false for an empty store", () => {
    expect(isFavorite("/a")).toBe(false);
  });

  it("returns true when the path is in the store", () => {
    localStorage.setItem(KEY, JSON.stringify([{ path: "/a", label: "A" }]));
    expect(isFavorite("/a")).toBe(true);
    expect(isFavorite("/b")).toBe(false);
  });
});

describe("toggleFavorite", () => {
  it("adds a new favorite to the front of the list and returns true", () => {
    localStorage.setItem(KEY, JSON.stringify([{ path: "/existing", label: "E" }]));
    const added = toggleFavorite("/a", "Alpha");
    expect(added).toBe(true);
    expect(getFavorites()).toEqual([
      { path: "/a", label: "Alpha" },
      { path: "/existing", label: "E" },
    ]);
  });

  it("removes an existing favorite and returns false", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { path: "/a", label: "A" },
        { path: "/b", label: "B" },
      ])
    );
    const added = toggleFavorite("/a", "A");
    expect(added).toBe(false);
    expect(getFavorites()).toEqual([{ path: "/b", label: "B" }]);
  });

  it("is its own inverse", () => {
    toggleFavorite("/x", "X");
    toggleFavorite("/x", "X");
    expect(getFavorites()).toEqual([]);
  });
});
