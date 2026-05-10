import { useEffect, useRef, useState } from "react";
import { useWs } from "./useWs.ts";

const ACTIVITY_TTL_MS = 2500;

/** Returns a Set of session IDs that have received output within the last 2.5 seconds. */
export function useSessionActivity(): ReadonlySet<string> {
  const ws = useWs();
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return ws.onMessage((msg) => {
      if (msg.type !== "output") return;
      const { sessionId } = msg;

      const existing = timers.current.get(sessionId);
      if (existing) clearTimeout(existing);

      setActive((prev) => {
        if (prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });

      timers.current.set(
        sessionId,
        setTimeout(() => {
          timers.current.delete(sessionId);
          setActive((prev) => {
            if (!prev.has(sessionId)) return prev;
            const next = new Set(prev);
            next.delete(sessionId);
            return next;
          });
        }, ACTIVITY_TTL_MS)
      );
    });
  }, [ws]);

  return active;
}
