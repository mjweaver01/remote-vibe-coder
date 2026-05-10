import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ChevronRight,
  Folder,
  History,
  Inbox,
  Search,
  SquareTerminal,
  Star,
  X,
} from "../components/icons.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { LoadingState } from "../components/LoadingState.tsx";
import { Topbar } from "../components/Topbar.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { useSessions } from "../hooks/useSessions.ts";
import { useSessionActivity } from "../hooks/useSessionActivity.ts";
import { fetchFolders } from "../lib/api.ts";
import { getFavorites, isFavorite, toggleFavorite, type Favorite } from "../lib/favorites.ts";

const PATH_PARAM = "path";

export function BrowserPage() {
  const [params, setParams] = useSearchParams();
  const path = params.get(PATH_PARAM) ?? undefined;
  const navigate = useNavigate();
  const sessions = useSessions();
  const activeSessionIds = useSessionActivity();
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<Favorite[]>(() => getFavorites());

  const { data, error, loading, reload } = useAsync((signal) => fetchFolders(path, signal), [path]);

  useEffect(() => {
    if (data) document.title = `${data.cwdLabel} · remote-vibe-coder`;
    else document.title = "remote-vibe-coder";
  }, [data]);

  // Clear filter when navigating to a different folder
  useEffect(() => {
    setQuery("");
  }, [path]);

  const navigateTo = (next: string) => {
    const sp = new URLSearchParams();
    sp.set(PATH_PARAM, next);
    setParams(sp);
  };

  const handleToggleFavorite = (entryPath: string, label: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(entryPath, label);
    setFavorites(getFavorites());
  };

  const q = query.trim().toLowerCase();
  const visibleEntries = q
    ? (data?.entries ?? []).filter((e) => e.name.toLowerCase().includes(q))
    : (data?.entries ?? []);

  return (
    <main className="page page-browser">
      <Topbar title="remote-vibe-coder" subtitle={data ? data.cwdLabel : (path ?? "")} />
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
                      <div className="row-name">
                        {s.cwdLabel}
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

            {favorites.length > 0 ? (
              <section className="rows">
                <div className="rows-title">Favorites</div>
                {favorites.map((fav) => (
                  <div key={fav.path} className="row row-folder">
                    <button
                      type="button"
                      className="row-press"
                      onClick={() => navigateTo(fav.path)}
                    >
                      <Folder size={18} className="row-icon" aria-hidden="true" />
                      <div className="row-body">
                        <div className="row-name">{fav.label}</div>
                        <div className="row-meta">{fav.path}</div>
                      </div>
                      <ChevronRight size={16} className="row-chev" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="row-action row-star is-starred"
                      title="Remove from favorites"
                      onClick={(e) => handleToggleFavorite(fav.path, fav.label, e)}
                      aria-label="Remove from favorites"
                      aria-pressed={true}
                    >
                      <Star size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="row-action"
                      title="Open or resume in this folder"
                      onClick={() => navigate(`/p/${encodeURIComponent(fav.path)}`)}
                    >
                      <History size={14} aria-hidden="true" />
                      <span>Open</span>
                    </button>
                  </div>
                ))}
              </section>
            ) : null}

            <section className="rows">
              <div className="rows-title">
                <span>{data.cwdLabel}</span>
                <div className="browser-search-wrap">
                  <Search size={12} className="browser-search-icon" aria-hidden="true" />
                  <input
                    type="search"
                    className="browser-search-input"
                    placeholder="Filter…"
                    value={query}
                    onChange={(e) => setQuery(e.currentTarget.value)}
                    aria-label="Filter folders"
                  />
                  {query ? (
                    <button
                      type="button"
                      className="browser-search-clear"
                      onClick={() => setQuery("")}
                      aria-label="Clear filter"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>

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
              ) : visibleEntries.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No matches"
                  description={`No folders contain "${query}"`}
                />
              ) : (
                visibleEntries.map((e) => {
                  const starred = isFavorite(e.path);
                  return (
                    <div key={e.path} className="row row-folder">
                      <button type="button" className="row-press" onClick={() => navigateTo(e.path)}>
                        <Folder size={18} className="row-icon" aria-hidden="true" />
                        <div className="row-body">
                          <div className="row-name">{e.name}</div>
                        </div>
                        <ChevronRight size={16} className="row-chev" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`row-action row-star${starred ? " is-starred" : ""}`}
                        title={starred ? "Remove from favorites" : "Add to favorites"}
                        onClick={(evt) => handleToggleFavorite(e.path, e.name, evt)}
                        aria-label={starred ? "Remove from favorites" : "Add to favorites"}
                        aria-pressed={starred}
                      >
                        <Star size={14} aria-hidden="true" />
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
                  );
                })
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
