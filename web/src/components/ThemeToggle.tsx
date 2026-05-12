import { IconButton } from "./IconButton.tsx";
import { Monitor, Moon, Sun } from "./icons.ts";
import { useTheme } from "../hooks/useTheme.ts";

export function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const Icon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;
  const label =
    pref === "light"
      ? "Theme: light (click for dark)"
      : pref === "dark"
        ? "Theme: dark (click for system)"
        : "Theme: system (click for light)";
  return <IconButton icon={Icon} label={label} onClick={cycle} />;
}
