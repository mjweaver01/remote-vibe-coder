import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Run an async producer and track its result. The producer receives an
 * AbortSignal that fires when the dependencies change or the component
 * unmounts — call sites should pass it to fetch().
 */
export function useAsync<T>(
  producer: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    producer(ctrl.signal)
      .then((data) => {
        if (cancelled) return;
        setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          data: null,
          error: err instanceof Error ? err : new Error(String(err)),
          loading: false,
        });
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
