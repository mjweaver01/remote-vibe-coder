import "@testing-library/jest-dom/vitest";

// Node 25 ships a built-in `localStorage` that shadows jsdom's window.localStorage
// at the globalThis level. Without `--localstorage-file`, Node's stub is missing
// methods like `.clear()`, breaking tests. Re-pin the globals to jsdom's storage.
Object.defineProperty(globalThis, "localStorage", {
  value: window.localStorage,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: window.sessionStorage,
  writable: true,
  configurable: true,
});
