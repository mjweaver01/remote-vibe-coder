import { Loader2 } from "./icons.ts";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <Loader2 className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
