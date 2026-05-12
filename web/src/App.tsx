import { Outlet } from "react-router";
import { AuthGate } from "./components/AuthGate.tsx";
import { ConnectionBanner } from "./components/ConnectionBanner.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ToastViewport } from "./components/ToastViewport.tsx";
import { ToastProvider } from "./providers/ToastProvider.tsx";
import { WsProvider } from "./providers/WsProvider.tsx";

export function App() {
  return (
    <WsProvider>
      <ToastProvider>
        <div className="app-shell">
          <ConnectionBanner />
          <ErrorBoundary>
            <AuthGate>
              <Outlet />
            </AuthGate>
          </ErrorBoundary>
          <ToastViewport />
        </div>
      </ToastProvider>
    </WsProvider>
  );
}
