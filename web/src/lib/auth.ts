// Token management. The server prints a token on startup when bound to LAN;
// the user appends it as ?token=… on first load. We persist it to
// localStorage (so closing the tab doesn't lock you out of the running
// sessions on the server) and strip it from the visible URL so refreshes
// work. Use signOut() to clear it.

const STORAGE_KEY = "rvc.token";
const LEGACY_SESSION_KEY = "rvc.token";

let cached: string | null | undefined;

function readStored(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) return v;
    // Migrate older sessionStorage tokens forward so existing tabs keep working.
    const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy) {
      localStorage.setItem(STORAGE_KEY, legacy);
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
      return legacy;
    }
  } catch {}
  return null;
}

export function getToken(): string | null {
  if (cached !== undefined) return cached;

  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    try {
      localStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {}
    url.searchParams.delete("token");
    const clean = url.pathname + (url.search ? `?${url.searchParams.toString()}` : "") + url.hash;
    window.history.replaceState({}, "", clean || "/");
    cached = fromUrl;
    return fromUrl;
  }

  cached = readStored();
  return cached;
}

/**
 * Persist a token from a pasted URL or raw value. Used by the sign-in screen
 * when the PWA boots without a token (iOS standalone PWAs have an isolated
 * storage partition from Safari tabs, so a previously-saved token isn't
 * visible). Returns the extracted token, or null if nothing usable was found.
 */
export function setToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let token = trimmed;
  try {
    const maybeUrl = new URL(trimmed, window.location.origin);
    const fromUrl = maybeUrl.searchParams.get("token");
    if (fromUrl) token = fromUrl;
  } catch {}
  if (!token) return null;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {}
  cached = token;
  return token;
}

/** Clear the persisted token without navigating. */
export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {}
  cached = null;
}

/** Clear the persisted token and reload to the unauthenticated state. */
export function signOut(): void {
  clearToken();
  window.location.assign("/");
}

export function hasStoredToken(): boolean {
  return !!readStored();
}

/** Append the token (if any) to a URL or path. */
export function withToken(input: string): string {
  const token = getToken();
  if (!token) return input;
  const url = new URL(input, window.location.origin);
  url.searchParams.set("token", token);
  return url.pathname + (url.search ? `?${url.searchParams.toString()}` : "");
}

/** Build an absolute WebSocket URL with token. */
export function wsUrl(path = "/ws"): string {
  const token = getToken();
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const url = new URL(`${proto}://${window.location.host}${path}`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}
