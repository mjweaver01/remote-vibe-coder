// Token management. The server prints a token on startup when bound to LAN;
// the user appends it as ?token=… on first load. We snapshot it into
// sessionStorage and strip it from the visible URL so refreshes work.

const STORAGE_KEY = "rvc.token";

let cached: string | null | undefined;

export function getToken(): string | null {
  if (cached !== undefined) return cached;

  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    sessionStorage.setItem(STORAGE_KEY, fromUrl);
    url.searchParams.delete("token");
    const clean = url.pathname + (url.search ? `?${url.searchParams.toString()}` : "") + url.hash;
    window.history.replaceState({}, "", clean || "/");
    cached = fromUrl;
    return fromUrl;
  }

  cached = sessionStorage.getItem(STORAGE_KEY);
  return cached;
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
