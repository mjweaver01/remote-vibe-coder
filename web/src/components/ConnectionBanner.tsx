import { Loader2, AlertCircle, RefreshCw } from "./icons.ts";
import { useWsStatus } from "../hooks/useWsStatus.ts";
import { useWs } from "../hooks/useWs.ts";

export function ConnectionBanner() {
  const status = useWsStatus();
  const ws = useWs();
  if (status === "open") return null;
  return (
    <div className={`conn-banner conn-${status}`} role="status">
      {status === "reconnecting" ? (
        <>
          <Loader2 size={14} className="spin" aria-hidden="true" />
          <span>Reconnecting…</span>
        </>
      ) : status === "unauthorized" ? (
        <>
          <AlertCircle size={14} aria-hidden="true" />
          <span>Invalid or expired token — open the pairing link again</span>
        </>
      ) : status === "dead" ? (
        <>
          <AlertCircle size={14} aria-hidden="true" />
          <span>Server unreachable</span>
          <button
            type="button"
            className="conn-banner-btn"
            onClick={() => ws.retry()}
            aria-label="Retry connection"
          >
            <RefreshCw size={12} aria-hidden="true" />
            Retry
          </button>
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
