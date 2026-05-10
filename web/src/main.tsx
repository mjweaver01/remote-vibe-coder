import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router.tsx";

if (import.meta.env.DEV) {
  let stamp: string | null = null;
  const id = setInterval(() => {
    fetch(`/assets/dev-stamp.txt?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((v) => {
        if (stamp === null) { stamp = v; return; }
        if (v !== stamp) window.location.reload();
      })
      .catch(() => clearInterval(id));
  }, 1500);
}

const container = document.getElementById("app");
if (!container) throw new Error("#app element missing from index.html");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
