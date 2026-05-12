import { Link } from "react-router";
import { ChevronRight, SquareTerminal } from "./icons.ts";
import type { SessionInfo } from "../../../src/types.ts";

interface Props {
  sessions: SessionInfo[];
  activeIds: ReadonlySet<string>;
  /** Show the folder name in the meta line. Picker hides it (you're already on that folder). */
  showCwd?: boolean;
  /** Title to render when a session has no resolved Claude conversation title yet. */
  fallback?: (s: SessionInfo) => string;
}

export function ActiveSessionsList({ sessions, activeIds, showCwd = false, fallback }: Props) {
  if (sessions.length === 0) return null;
  const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <section className="rows">
      <div className="rows-title">Active sessions</div>
      {sorted.map((s) => {
        const title = s.title || (fallback ? fallback(s) : s.cwdLabel);
        const meta = [
          showCwd && s.title ? s.cwdLabel : null,
          s.viewers > 0 ? (s.viewers === 1 ? "1 viewer" : `${s.viewers} viewers`) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Link key={s.id} to={`/s/${s.id}`} className="row row-session">
            <SquareTerminal size={18} className="row-icon" aria-hidden="true" />
            <div className="row-body">
              <div className="row-name" title={title}>
                {title}
                {activeIds.has(s.id) ? (
                  <span className="session-activity-dot" aria-label="Active" />
                ) : null}
              </div>
              {meta ? <div className="row-meta">{meta}</div> : null}
            </div>
            <ChevronRight size={16} className="row-chev" aria-hidden="true" />
          </Link>
        );
      })}
    </section>
  );
}
