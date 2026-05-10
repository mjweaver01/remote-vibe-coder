import { Loader2, AlertCircle } from "./icons.ts";
import { useWsStatus } from "../hooks/useWsStatus.ts";

export function ConnectionBanner() {
  const status = useWsStatus();
  if (status === "open") return null;
  return (
    <div className={`conn-banner conn-${status}`} role="status">
      {status === "reconnecting" ? (
        <>
          <Loader2 size={14} className="spin" aria-hidden="true" />
          <span>Reconnecting…</span>
        </>
      ) : status === "closed" ? (
        <>
          <AlertCircle size={14} aria-hidden="true" />
          <span>Disconnected</span>
        </>
      ) : (
        <>
          <Loader2 size={14} className="spin" aria-hidden="true" />
          <span>Connecting…</span>
        </>
      )}
    </div>
  );
}
