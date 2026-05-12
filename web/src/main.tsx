import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router.tsx";
import { applyStoredThemeEarly } from "./hooks/useTheme.ts";

applyStoredThemeEarly();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const container = document.getElementById("app");
if (!container) throw new Error("#app element missing from index.html");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
