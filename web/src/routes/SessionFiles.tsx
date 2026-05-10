import { useOutletContext, useSearchParams } from "react-router";
import {
  ChevronLeft,
  Code2,
  FileCode2,
  File,
  GitBranch,
  GitCompare,
  Inbox,
  Menu,
  X,
} from "../components/icons.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { FileTree } from "../components/FileTree.tsx";
import { GitPanel } from "../components/GitPanel.tsx";
import { MonacoCode } from "../components/MonacoCode.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { fetchDiff, fetchFile, fetchGitStatus } from "../lib/api.ts";
import type { SessionInfo } from "../../../src/types.ts";
import { useState } from "react";

interface OutletCtx {
  session: SessionInfo;
}

type SidebarMode = "explorer" | "source-control";

export function SessionFiles() {
  const { session } = useOutletContext<OutletCtx>();
  const [params, setParams] = useSearchParams();
  const [treeOpen, setTreeOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("explorer");

  const filePath = params.get("file");
  const isDiff = params.get("view") === "diff";

  // Tabs are stored as repeated ?tabs= params. If a file is set but not yet in
  // the tab list (e.g. direct URL navigation), include it implicitly.
  const rawTabs = params.getAll("tabs");
  const openTabs = filePath && !rawTabs.includes(filePath) ? [...rawTabs, filePath] : rawTabs;

  const gitStatus = useAsync(
    (signal) => fetchGitStatus(session.cwd, signal),
    [session.cwd]
  );
  const changedPaths = gitStatus.data?.inGit
    ? new Set([
        ...gitStatus.data.staged.map((f) => f.path),
        ...gitStatus.data.unstaged.map((f) => f.path),
        ...gitStatus.data.untracked.map((f) => f.path),
      ])
    : undefined;

  const file = useAsync(
    async (signal) => (filePath ? fetchFile(filePath, signal) : null),
    [filePath]
  );
  const diff = useAsync(
    async (signal) => (filePath && isDiff ? fetchDiff(filePath, signal) : null),
    [filePath, isDiff]
  );

  const setFile = (path: string) => {
    const sp = new URLSearchParams(params);
    sp.set("file", path);
    const currentTabs = sp.getAll("tabs");
    if (!currentTabs.includes(path)) sp.append("tabs", path);
    if (sidebarMode === "source-control") sp.set("view", "diff");
    setParams(sp, { replace: false });
    setTreeOpen(false);
  };

  const selectTab = (path: string) => {
    const sp = new URLSearchParams(params);
    sp.set("file", path);
    setParams(sp, { replace: false });
  };

  const closeTab = (path: string) => {
    const sp = new URLSearchParams(params);
    const remaining = openTabs.filter((t) => t !== path);
    sp.delete("tabs");
    remaining.forEach((t) => sp.append("tabs", t));
    if (filePath === path) {
      const idx = openTabs.indexOf(path);
      const next = remaining[idx] ?? remaining[idx - 1] ?? null;
      if (next) sp.set("file", next);
      else sp.delete("file");
    }
    setParams(sp, { replace: false });
  };

  const toggleDiff = () => {
    const sp = new URLSearchParams(params);
    if (isDiff) sp.delete("view");
    else sp.set("view", "diff");
    setParams(sp, { replace: true });
  };

  const fileName = filePath ? (filePath.split("/").pop() ?? "") : "";
  const inGit = diff.data?.inGit ?? null;
  const isUntracked = diff.data?.isUntracked ?? false;

  let diffLabel: string | null = null;
  if (filePath && isDiff) {
    if (inGit === false) diffLabel = "Not in a git repo";
    else if (isUntracked) diffLabel = "Untracked file";
    else diffLabel = "Diff vs HEAD";
  }

  let viewerNode;
  if (file.loading || (isDiff && diff.loading)) {
    viewerNode = (
      <div className="files-viewer-status">
        <span>Loading…</span>
      </div>
    );
  } else if (file.error) {
    viewerNode = (
      <EmptyState
        icon={Inbox}
        tone="error"
        title="Couldn't open file"
        description={<code className="empty-state-detail">{file.error.message}</code>}
        action={
          <button className="btn" onClick={file.reload}>
            Retry
          </button>
        }
      />
    );
  } else if (!filePath || !file.data) {
    viewerNode = (
      <EmptyState
        icon={FileCode2}
        title="Open a file to start"
        description="Pick any file from the tree to view it here. Use the diff button to compare with HEAD."
      />
    );
  } else if (file.data.binary) {
    viewerNode = (
      <EmptyState
        icon={FileCode2}
        title="Binary file"
        description={`${(file.data.bytes / 1024).toFixed(0)} KB — preview is not supported.`}
      />
    );
  } else if (isDiff) {
    if (diff.error) {
      viewerNode = (
        <EmptyState
          icon={Inbox}
          tone="error"
          title="Couldn't load diff"
          description={<code className="empty-state-detail">{diff.error.message}</code>}
          action={
            <button className="btn" onClick={diff.reload}>
              Retry
            </button>
          }
        />
      );
    } else if (diff.data) {
      viewerNode = (
        <MonacoCode
          fileName={fileName}
          diff={{ original: diff.data.original ?? "", modified: diff.data.modified ?? "" }}
        />
      );
    } else {
      viewerNode = null;
    }
  } else {
    viewerNode = <MonacoCode fileName={fileName} code={file.data.content} />;
  }

  return (
    <section className="tab-pane tab-pane-files">
      <div className="files-toolbar">
        <button
          type="button"
          className="files-tree-toggle"
          aria-label={treeOpen ? "Hide tree" : "Show tree"}
          aria-pressed={treeOpen}
          onClick={() => setTreeOpen((v) => !v)}
        >
          {treeOpen ? (
            <ChevronLeft size={14} aria-hidden="true" />
          ) : (
            <Menu size={14} aria-hidden="true" />
          )}
        </button>
        <div className="files-status" aria-live="polite">
          {diffLabel ?? (filePath ? filePath : "No file open")}
        </div>
        <button
          type="button"
          className={`btn${sidebarMode === "source-control" ? " is-active" : ""}`}
          onClick={() => {
            setSidebarMode((m) => {
              if (m !== "source-control") setTreeOpen(true);
              return m === "source-control" ? "explorer" : "source-control";
            });
          }}
          title={sidebarMode === "source-control" ? "Show file explorer" : "Show source control"}
          aria-pressed={sidebarMode === "source-control"}
        >
          {sidebarMode === "source-control" ? (
            <File size={14} aria-hidden="true" />
          ) : (
            <GitBranch size={14} aria-hidden="true" />
          )}
          <span>{sidebarMode === "source-control" ? "Explorer" : "Changes"}</span>
        </button>
        <button
          type="button"
          className={`btn${isDiff ? " is-active" : ""}`}
          disabled={!filePath}
          onClick={toggleDiff}
          aria-pressed={isDiff}
        >
          {isDiff ? (
            <Code2 size={14} aria-hidden="true" />
          ) : (
            <GitCompare size={14} aria-hidden="true" />
          )}
          <span>{isDiff ? "Code" : "Diff"}</span>
        </button>
      </div>

      <div className={`files-body${treeOpen ? " tree-open" : ""}`}>
        <aside className="files-tree">
          {sidebarMode === "source-control" ? (
            <GitPanel cwd={session.cwd} onSelectFile={setFile} selectedPath={filePath} />
          ) : (
            <FileTree
              rootPath={session.cwd}
              selectedPath={filePath}
              onSelectFile={setFile}
              changedPaths={changedPaths}
            />
          )}
        </aside>
        <main className="files-viewer">
          {openTabs.length > 0 && (
            <div className="files-tabs" role="tablist" aria-label="Open files">
              {openTabs.map((tab) => {
                const name = tab.split("/").pop() ?? tab;
                const isActive = tab === filePath;
                const isChanged = changedPaths?.has(tab);
                return (
                  <div
                    key={tab}
                    className={`files-tab${isActive ? " is-active" : ""}${isChanged ? " is-changed" : ""}`}
                    role="tab"
                    aria-selected={isActive}
                  >
                    <button
                      type="button"
                      className="files-tab-label"
                      onClick={() => selectTab(tab)}
                      title={tab}
                    >
                      {name}
                    </button>
                    <button
                      type="button"
                      className="files-tab-close"
                      onClick={() => closeTab(tab)}
                      aria-label={`Close ${name}`}
                    >
                      <X size={11} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {viewerNode}
        </main>
      </div>
    </section>
  );
}
