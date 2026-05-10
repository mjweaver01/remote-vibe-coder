import { createContext, useCallback, useState, type ReactNode } from 'react';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  message: string;
}

export interface ToastApi {
  toasts: Toast[];
  push(kind: Toast['kind'], message: string): number;
  dismiss(id: number): void;
}

export const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;
const DURATION_MS = 5_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: Toast['kind'], message: string) => {
      const id = nextId++;
      setToasts((cur) => [...cur, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
      return id;
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toasts, push, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}
