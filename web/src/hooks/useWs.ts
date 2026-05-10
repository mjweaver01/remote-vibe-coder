import { useContext } from "react";
import { WsContext } from "../providers/WsProvider.tsx";
import type { WsClient } from "../lib/ws.ts";

export function useWs(): WsClient {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWs must be used inside <WsProvider>");
  return ctx;
}
