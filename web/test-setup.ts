import "@testing-library/jest-dom/vitest";

// Node 25 ships a built-in `localStorage` getter on globalThis (enabled by
// default via webstorage). Without `--localstorage-file` it throws / returns a
// stub missing `.clear()`. Replace those globals with fresh jsdom-style Storage
// shims so tests get a working API in both environments.
function makeStorageShim(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  };
}
for (const key of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, key, {
    value: makeStorageShim(),
    writable: true,
    configurable: true,
  });
}
