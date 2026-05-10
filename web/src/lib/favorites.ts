const KEY = "rvc:favorites";

export interface Favorite {
  path: string;
  label: string;
}

export function getFavorites(): Favorite[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Favorite[];
  } catch {
    return [];
  }
}

export function isFavorite(path: string): boolean {
  return getFavorites().some((f) => f.path === path);
}

export function toggleFavorite(path: string, label: string): boolean {
  const current = getFavorites();
  const idx = current.findIndex((f) => f.path === path);
  if (idx !== -1) {
    current.splice(idx, 1);
    localStorage.setItem(KEY, JSON.stringify(current));
    return false;
  } else {
    current.unshift({ path, label });
    localStorage.setItem(KEY, JSON.stringify(current));
    return true;
  }
}
