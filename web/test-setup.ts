import "@testing-library/jest-dom/vitest";

// Node 25 ships a built-in `localStorage` getter on globalThis (enabled by
// default via webstorage). Without `--localstorage-file` it throws / returns a
// stub missing `.clear()`. Delete Node's getter so jsdom's window.localStorage
// resolves on the global instead.
for (const key of ["localStorage", "sessionStorage"] as const) {
  try {
    delete (globalThis as Record<string, unknown>)[key];
  } catch {}
  Object.defineProperty(globalThis, key, {
    value: window[key],
    writable: true,
    configurable: true,
  });
}
