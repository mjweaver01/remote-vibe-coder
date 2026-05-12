import { useEffect, useState, type ReactNode } from "react";
import { fetchConfig } from "../lib/api.ts";
import { hasStoredToken } from "../lib/auth.ts";
import { useWsStatus } from "../hooks/useWsStatus.ts";
import { LoadingState } from "./LoadingState.tsx";
import { SignInScreen } from "./SignInScreen.tsx";

export function AuthGate({ children }: { children: ReactNode }) {
  const wsStatus = useWsStatus();
  const [needsAuth, setNeedsAuth] = useState<boolean | null>(() =>
    hasStoredToken() ? false : null
  );

  useEffect(() => {
    if (hasStoredToken()) return;
    let cancelled = false;
    fetchConfig()
      .then((cfg) => {
        if (!cancelled) setNeedsAuth(cfg.hasToken && !hasStoredToken());
      })
      .catch(() => {
        // Treat any failure as "auth required" so the user can paste a token
        // rather than getting stuck on a loading screen.
        if (!cancelled) setNeedsAuth(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (wsStatus === "unauthorized" || needsAuth === true) return <SignInScreen />;
  if (needsAuth === null) return <LoadingState label="Connecting…" />;
  return <>{children}</>;
}
