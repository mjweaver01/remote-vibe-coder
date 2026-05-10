import { AlertCircle, X } from "./icons.ts";
import { useToast } from "../hooks/useToast.ts";

export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-viewport" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          role={t.kind === "error" ? "alert" : "status"}
        >
          {t.kind === "error" ? <AlertCircle size={16} aria-hidden="true" /> : null}
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
