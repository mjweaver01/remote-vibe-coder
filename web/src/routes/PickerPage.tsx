import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, ChevronRight, History, Inbox, Plus, RotateCcw, SquareTerminal } from "../components/icons.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { LoadingState } from "../components/LoadingState.tsx";
import { Topbar } from "../components/Topbar.tsx";
import { IconButton } from "../components/IconButton.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { useSessions } from "../hooks/useSessions.ts";
import { useSessionActivity } from "../hooks/useSessionActivity.ts";
import { useToast } from "../hooks/useToast.ts";
import { useWs } from "../hooks/useWs.ts";
import { fetchHistory } from "../lib/api.ts";
import type { CreateMode, ServerMessage } from "../../../src/types.ts";

const RELATIVE_TIME = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relTime(ms: number): string {
  const sec = Math.round(-ms / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return RELATIVE_TIME.format(sec, "second");
  if (abs < 3600) return RELATIVE_TIME.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return RELATIVE_TIME.format(Math.round(sec / 3600), "hour");
  if (abs < 86400 * 30) return RELATIVE_TIME.format(Math.round(sec / 86400), "day");
  if (abs < 86400 * 365) return RELATIVE_TIME.format(Math.round(sec / (86400 * 30)), "month");
  return RELATIVE_TIME.format(Math.round(sec / (86400 * 365)), "year");
}

function approxTerminalSize(): { cols: number; rows: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cols = Math.max(40, Math.floor(w / 8));
  // 130px approximates topbar + tab strip + keybar chrome; 17px ≈ one terminal line
  const rows = Math.max(12, Math.floor((h - 130) / 17));
  return { cols, rows };
}

export function PickerPage() {
  const { cwd: rawCwd } = useParams<{ cwd: string }>();
  const cwd = rawCwd ? decodeURIComponent(rawCwd) : "";
  const navigate = useNavigate();
  const ws = useWs();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const sessions = useSessions();
  const activeSessionIds = useSessionActivity();
  const activeSessions = sessions.filter((s) => s.cwd === cwd);

  const { data, error, loading, reload } = useAsync((signal) => fetchHistory(cwd, signal), [cwd]);

  const folderName = cwd.split("/").filter(Boolean).pop() || cwd;
  const sessionsList = data?.sessions ?? [];
  const hasHistory = sessionsList.length > 0;

  const startSession = (mode: CreateMode) => {
    if (busy) return;
    setBusy(true);
    const { cols, rows } = approxTerminalSize();
    const off = ws.onMessage((m: ServerMessage) => {
      if (m.type === "created") {
        off();
        setBusy(false);
        navigate(`/s/${m.session.id}`);
      } else if (m.type === "error") {
        off();
        setBusy(false);
        toast.push("error", m.message);
      }
    });
    ws.send({ type: "create", cwd, cols, rows, mode });
  };

  return (
    <main className="page page-picker">
      <Topbar
        leading={
          <IconButton icon={ArrowLeft} label="Back" onClick={() => navigate("/")} size="sm" />
        }
        title={folderName}
        subtitle={cwd}
      />

      <div className="page-body">
        {activeSessions.length > 0 ? (
          <section className="rows">
            <div className="rows-title">Active sessions</div>
            {activeSessions.map((s) => (
              <Link key={s.id} to={`/s/${s.id}`} className="row row-session">
                <SquareTerminal size={18} className="row-icon" aria-hidden="true" />
                <div className="row-body">
                  <div className="row-name" title={s.title || "Session"}>
                    {s.title || "Session"}
                    {activeSessionIds.has(s.id) ? (
                      <span className="session-activity-dot" aria-label="Active" />
                    ) : null}
                  </div>
                  <div className="row-meta">
                    {s.viewers === 1 ? "1 viewer" : `${s.viewers} viewers`}
                  </div>
                </div>
                <ChevronRight size={16} className="row-chev" aria-hidden="true" />
              </Link>
            ))}
          </section>
        ) : null}

        <div className="picker-actions">
          <button
            type="button"
            className="btn primary big"
            onClick={() => startSession({ kind: "new" })}
            disabled={busy}
          >
            <Plus size={16} aria-hidden="true" />
            New conversation
          </button>
          <button
            type="button"
            className="btn big"
            onClick={() => startSession({ kind: "continue" })}
            disabled={busy || !hasHistory}
            title={
              hasHistory ? "Resume the most recent conversation" : "No previous conversation here"
            }
          >
            <RotateCcw size={16} aria-hidden="true" />
            Continue last
          </button>
        </div>

        <section className="rows">
          <div className="rows-title">Past conversations</div>

          {loading ? <LoadingState label="Reading conversation history…" /> : null}

          {error ? (
            <EmptyState
              icon={Inbox}
              tone="error"
              title="Couldn't load history"
              description={<code className="empty-state-detail">{error.message}</code>}
              action={
                <button className="btn" onClick={reload}>
                  Retry
                </button>
              }
            />
          ) : null}

          {data && !loading && !error ? (
            sessionsList.length === 0 ? (
              <EmptyState
                icon={History}
                title="No past conversations"
                description="Start a new conversation and it'll show up here next time."
              />
            ) : (
              sessionsList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="row row-history"
                  disabled={busy}
                  onClick={() => startSession({ kind: "resume", conversationId: s.id })}
                >
                  <div className="row-body">
                    <div className="row-name">{s.preview || "(no preview available)"}</div>
                    <div className="row-meta">
                      {relTime(Date.now() - s.mtime)} · {Math.round(s.sizeBytes / 1024)} KB
                    </div>
                  </div>
                  <ChevronRight size={16} className="row-chev" aria-hidden="true" />
                </button>
              ))
            )
          ) : null}
        </section>
      </div>
    </main>
  );
}
