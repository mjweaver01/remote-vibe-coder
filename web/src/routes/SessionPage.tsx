import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router";
import { ArrowLeft, Code2, FileX, Inbox, SquareTerminal, Trash2 } from "../components/icons.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { IconButton } from "../components/IconButton.tsx";
import { Topbar } from "../components/Topbar.tsx";
import { useSession } from "../hooks/useSessions.ts";
import { useWs } from "../hooks/useWs.ts";

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
      ) : (
        <Outlet context={{ session }} />
      )}
    </main>
  );
}
