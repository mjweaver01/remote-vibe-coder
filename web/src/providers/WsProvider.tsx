import { createContext, useEffect, useRef, type ReactNode } from "react";
import { getWsClient, type WsClient } from "../lib/ws.ts";

export const WsContext = createContext<WsClient | null>(null);

export function WsProvider({ children }: { children: ReactNode }) {
  const ref = useRef<WsClient | null>(null);
  if (!ref.current) ref.current = getWsClient();

  useEffect(() => {
    // The singleton is started on first access; this is just a placeholder
    // for any future side effects we want bound to the lifetime of the app.
    return () => {
      // Intentionally do not destroy here — the singleton persists across
      // route remounts so reconnection state is preserved.
    };
  }, []);

  return <WsContext.Provider value={ref.current}>{children}</WsContext.Provider>;
}
