import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router";
import {
  AlertCircle,
  ArrowLeft,
  Code2,
  FileX,
  Inbox,
  Loader2,
  RefreshCw,
  SquareTerminal,
  Trash2,
} from "../components/icons.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { IconButton } from "../components/IconButton.tsx";
import { Topbar } from "../components/Topbar.tsx";
import { useSession } from "../hooks/useSessions.ts";
import { useWs } from "../hooks/useWs.ts";
import type { ServerMessage } from "../../../src/types.ts";

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const session = useSession(sessionId);
  const ws = useWs();
  const navigate = useNavigate();

  if (!sessionId) {
    return (
      <main className="page">
        <EmptyState icon={FileX} title="Missing session id" tone="error" />
      </main>
    );
  }

  const handleKill = () => {
    if (window.confirm("Kill this Claude session?")) {
      ws.send({ type: "kill", sessionId });
      const cwd = session?.cwd;
      navigate(cwd ? `/p/${encodeURIComponent(cwd)}` : "/");
    }
  };

  const [reloading, setReloading] = useState(false);
  // Snapshot the info needed to respawn, taken at click time. We can't read it
  // off `session` later because the server deletes the entry on `ended`, which
  // would null out cwd/conversationId before we get to fire `create`.
  const reloadCtxRef = useRef<{
    cwd: string;
    conversationId: string;
    cols: number;
    rows: number;
  } | null>(null);

  useEffect(() => {
    if (!reloading) return;
    const ctx = reloadCtxRef.current;
    if (!ctx) return;
    const off = ws.onMessage((m: ServerMessage) => {
      if (
        m.type === "created" &&
        m.session.cwd === ctx.cwd &&
        m.session.conversationId === ctx.conversationId
      ) {
        reloadCtxRef.current = null;
        setReloading(false);
        navigate(`/s/${m.session.id}`, { replace: true });
      } else if (m.type === "error") {
        reloadCtxRef.current = null;
        setReloading(false);
      }
    });
    return off;
  }, [reloading, sessionId, ws, navigate]);

  const handleReload = () => {
    if (reloading) return;
    if (!session?.conversationId) return;
    reloadCtxRef.current = {
      cwd: session.cwd,
      conversationId: session.conversationId,
      cols: session.cols || 80,
      rows: session.rows || 24,
    };
    setReloading(true);
    // Server handles kill + wait-for-stable-jsonl + resume atomically and
    // replies with `created`. This avoids a race where claude --resume reads
    // the JSONL before VS Code's claude has flushed its latest writes.
    ws.send({
      type: "reload",
      sessionId,
      cols: reloadCtxRef.current.cols,
      rows: reloadCtxRef.current.rows,
    });
  };

  const showExternalBanner = !!(session?.externallyUpdated && session.conversationId) || reloading;

  return (
    <main className="page page-session">
      <Topbar
        leading={
          <IconButton
            icon={ArrowLeft}
            label="Back"
            size="sm"
            onClick={() => navigate(session?.cwd ? `/p/${encodeURIComponent(session.cwd)}` : "/")}
          />
        }
        title={
          session
            ? session.title || session.cwdLabel
            : `session ${sessionId.slice(0, 6)}`
        }
        subtitle={
          session ? (
            <span>
              {session.cwd} · {session.viewers === 1 ? "1 viewer" : `${session.viewers} viewers`}
            </span>
          ) : (
            "reconnecting…"
          )
        }
        trailing={
          <IconButton
            icon={Trash2}
            label="Kill session"
            tone="danger"
            size="sm"
            onClick={handleKill}
          />
        }
      />

      {showExternalBanner ? (
        <div className="external-banner" role="status">
          {reloading ? (
            <>
              <Loader2 size={14} className="spin" aria-hidden="true" />
              <span>Reloading session…</span>
            </>
          ) : (
            <>
              <AlertCircle size={14} aria-hidden="true" />
              <span>Conversation updated outside this session</span>
              <button
                type="button"
                className="external-banner-btn"
                onClick={handleReload}
                aria-label="Reload to sync"
              >
                <RefreshCw size={12} aria-hidden="true" />
                Reload
              </button>
            </>
          )}
        </div>
      ) : null}

      <nav className="tabstrip" aria-label="Session views">
        <NavLink
          end
          to={`/s/${sessionId}`}
          className={({ isActive }) => `tab-btn${isActive ? " is-active" : ""}`}
        >
          <SquareTerminal size={14} aria-hidden="true" />
          <span>Terminal</span>
        </NavLink>
        <NavLink
          to={`/s/${sessionId}/files`}
          className={({ isActive }) => `tab-btn${isActive ? " is-active" : ""}`}
        >
          <Code2 size={14} aria-hidden="true" />
          <span>Files</span>
        </NavLink>
      </nav>

      {!session ? (
        reloading ? null : (
          <EmptyState
            icon={Inbox}
            title="Session not found"
            description="The session may have ended. Start a new one from the picker."
            action={
              <Link className="btn primary" to="/">
                Back to start
              </Link>
            }
          />
        )
      ) : (
        <Outlet context={{ session, onKill: handleKill }} />
      )}
    </main>
  );
}
