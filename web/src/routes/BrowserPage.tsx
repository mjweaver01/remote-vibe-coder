import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ChevronRight, Folder, History, Inbox, SquareTerminal } from '../components/icons.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { LoadingState } from '../components/LoadingState.tsx';
import { Topbar } from '../components/Topbar.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { useSessions } from '../hooks/useSessions.ts';
import { fetchFolders } from '../lib/api.ts';

const PATH_PARAM = 'path';

export function BrowserPage() {
  const [params, setParams] = useSearchParams();
  const path = params.get(PATH_PARAM) ?? undefined;
  const navigate = useNavigate();
  const sessions = useSessions();

  const { data, error, loading, reload } = useAsync(
    (signal) => fetchFolders(path, signal),
    [path],
  );

  // Keep the page title in sync
  useEffect(() => {
    if (data) document.title = `${data.cwdLabel} · remote-vibe-coder`;
    else document.title = 'remote-vibe-coder';
  }, [data]);

  const navigateTo = (next: string) => {
    const sp = new URLSearchParams();
    sp.set(PATH_PARAM, next);
    setParams(sp);
  };

  return (
    <main className="page page-browser">
      <Topbar
        title="remote-vibe-coder"
        subtitle={data ? data.cwdLabel : path ?? ''}
      />
      <div className="page-body">
        {loading && !data ? <LoadingState label="Reading folder…" /> : null}

        {error ? (
          <EmptyState
            icon={Inbox}
            tone="error"
            title="Couldn't read that folder"
            description={<code className="empty-state-detail">{error.message}</code>}
            action={
              <button className="btn" onClick={reload}>
                Retry
              </button>
            }
          />
        ) : null}

        {data ? (
          <>
            {sessions.length > 0 ? (
              <section className="rows">
                <div className="rows-title">Active sessions</div>
                {sessions.map((s) => (
                  <Link key={s.id} to={`/s/${s.id}`} className="row row-session">
                    <SquareTerminal size={18} className="row-icon" aria-hidden="true" />
                    <div className="row-body">
                      <div className="row-name">{s.cwdLabel}</div>
                      <div className="row-meta">
                        {s.viewers === 1 ? '1 viewer' : `${s.viewers} viewers`}
                      </div>
                    </div>
                    <ChevronRight size={16} className="row-chev" aria-hidden="true" />
                  </Link>
                ))}
              </section>
            ) : null}

            <section className="rows">
              <div className="rows-title">{data.cwdLabel}</div>

              {data.parent ? (
                <button className="row" onClick={() => navigateTo(data.parent!)}>
                  <Folder size={18} className="row-icon" aria-hidden="true" />
                  <div className="row-body">
                    <div className="row-name">..</div>
                  </div>
                  <ChevronRight size={16} className="row-chev" aria-hidden="true" />
                </button>
              ) : null}

              {data.entries.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="No subfolders"
                  description="This folder has no child directories. Try drilling into a sibling, or pass --root to choose a different starting point."
                />
              ) : (
                data.entries.map((e) => (
                  <div key={e.path} className="row row-folder">
                    <button
                      type="button"
                      className="row-press"
                      onClick={() => navigateTo(e.path)}
                    >
                      <Folder size={18} className="row-icon" aria-hidden="true" />
                      <div className="row-body">
                        <div className="row-name">{e.name}</div>
                      </div>
                      <ChevronRight size={16} className="row-chev" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="row-action"
                      title="Open or resume in this folder"
                      onClick={() => navigate(`/p/${encodeURIComponent(e.path)}`)}
                    >
                      <History size={14} aria-hidden="true" />
                      <span>Open</span>
                    </button>
                  </div>
                ))
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
