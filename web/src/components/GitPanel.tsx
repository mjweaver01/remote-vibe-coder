import { useState, useCallback } from "react";
import {
  Check,
  File,
  GitBranch,
  GitCommit,
  Minus,
  Plus,
  RefreshCw,
} from "./icons.ts";
import { useAsync } from "../hooks/useAsync.ts";
import { useToast } from "../hooks/useToast.ts";
import {
  fetchGitStatus,
  postGitCommit,
  postGitStage,
  postGitUnstage,
} from "../lib/api.ts";
import type { GitFileStatus } from "../lib/api.ts";

interface Props {
  cwd: string;
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  M: "M",
  A: "A",
  D: "D",
  R: "R",
  C: "C",
  U: "U",
  "?": "?",
  "!": "!",
};

const STATUS_CLASS: Record<string, string> = {
  M: "git-badge-modified",
  A: "git-badge-added",
  D: "git-badge-deleted",
  R: "git-badge-renamed",
  "?": "git-badge-untracked",
};

function statusBadge(code: string) {
  const cls = STATUS_CLASS[code] ?? "git-badge-modified";
  const label = STATUS_LABEL[code] ?? code;
  return (
    <span className={`git-badge ${cls}`} aria-label={label}>
      {label}
    </span>
  );
}

interface FilRowProps {
  entry: GitFileStatus;
  statusCode: string;
  selected: boolean;
  onSelect: () => void;
  onAction: () => void;
  actionIcon: React.ReactNode;
  actionLabel: string;
}

function FileRow({ entry, statusCode, selected, onSelect, onAction, actionLabel, actionIcon }: FilRowProps) {
  const name = entry.relPath.split("/").pop() ?? entry.relPath;
  const dir = entry.relPath.includes("/")
    ? entry.relPath.slice(0, entry.relPath.lastIndexOf("/"))
    : null;

  return (
    <div
      className={`git-file-row${selected ? " is-selected" : ""}`}
      role="row"
    >
      <button
        type="button"
        className="git-file-main"
        onClick={onSelect}
        title={entry.relPath}
      >
        <File size={13} className="git-file-icon" aria-hidden="true" />
        <span className="git-file-name">{name}</span>
        {dir && <span className="git-file-dir">{dir}</span>}
        {statusBadge(statusCode)}
      </button>
      <button
        type="button"
        className="git-file-action"
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        title={actionLabel}
        aria-label={actionLabel}
      >
        {actionIcon}
      </button>
    </div>
  );
}

export function GitPanel({ cwd, onSelectFile, selectedPath }: Props) {
  const toast = useToast();
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const status = useAsync(
    (signal) => fetchGitStatus(cwd, signal),
    [cwd, reloadKey]
  );

  const stage = async (files: string[]) => {
    try {
      await postGitStage(files);
      reload();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Stage failed");
    }
  };

  const unstage = async (files: string[]) => {
    try {
      await postGitUnstage(files);
      reload();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Unstage failed");
    }
  };

  const commit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      const result = await postGitCommit(cwd, commitMsg.trim());
      toast.push("success", `Committed ${result.hash ? result.hash.slice(0, 7) : ""}`);
      setCommitMsg("");
      reload();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  if (status.loading) {
    return (
      <div className="git-panel-loading">
        <RefreshCw size={14} className="spin" aria-hidden="true" />
        <span>Loading…</span>
      </div>
    );
  }

  if (status.error) {
    return (
      <div className="git-panel-error">
        <span>{status.error.message}</span>
        <button type="button" className="btn" onClick={reload}>Retry</button>
      </div>
    );
  }

  const s = status.data;

  if (!s?.inGit) {
    return (
      <div className="git-panel-empty">
        <GitBranch size={20} aria-hidden="true" />
        <span>Not a git repository</span>
      </div>
    );
  }

  const totalChanges = s.staged.length + s.unstaged.length + s.untracked.length;

  return (
    <div className="git-panel">
      {/* Branch header */}
      <div className="git-panel-branch">
        <GitBranch size={13} aria-hidden="true" />
        <span>{s.branch ?? "HEAD"}</span>
        <button
          type="button"
          className="git-panel-refresh"
          onClick={reload}
          title="Refresh"
          aria-label="Refresh git status"
        >
          <RefreshCw size={12} aria-hidden="true" />
        </button>
      </div>

      {/* Commit box — shown whenever there are staged files */}
      {s.staged.length > 0 && (
        <div className="git-commit-box">
          <textarea
            className="git-commit-input"
            placeholder="Commit message…"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            rows={3}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void commit();
              }
            }}
          />
          <button
            type="button"
            className="btn primary git-commit-btn"
            disabled={!commitMsg.trim() || committing}
            onClick={() => void commit()}
          >
            <GitCommit size={13} aria-hidden="true" />
            <span>{committing ? "Committing…" : "Commit"}</span>
          </button>
        </div>
      )}

      {totalChanges === 0 && (
        <div className="git-panel-empty">
          <Check size={16} aria-hidden="true" />
          <span>No changes</span>
        </div>
      )}

      {/* Staged */}
      {s.staged.length > 0 && (
        <section className="git-section">
          <div className="git-section-header">
            <span>Staged Changes</span>
            <button
              type="button"
              className="git-section-action"
              onClick={() => void unstage(s.staged.map((f) => f.path))}
              title="Unstage all"
            >
              <Minus size={12} aria-hidden="true" />
            </button>
          </div>
          {s.staged.map((f) => (
            <FileRow
              key={f.path + "-staged"}
              entry={f}
              statusCode={f.indexStatus}
              selected={selectedPath === f.path}
              onSelect={() => onSelectFile(f.path)}
              onAction={() => void unstage([f.path])}
              actionLabel="Unstage"
              actionIcon={<Minus size={12} aria-hidden="true" />}
            />
          ))}
        </section>
      )}

      {/* Unstaged */}
      {s.unstaged.length > 0 && (
        <section className="git-section">
          <div className="git-section-header">
            <span>Changes</span>
            <button
              type="button"
              className="git-section-action"
              onClick={() => void stage(s.unstaged.map((f) => f.path))}
              title="Stage all"
            >
              <Plus size={12} aria-hidden="true" />
            </button>
          </div>
          {s.unstaged.map((f) => (
            <FileRow
              key={f.path + "-unstaged"}
              entry={f}
              statusCode={f.workingStatus}
              selected={selectedPath === f.path}
              onSelect={() => onSelectFile(f.path)}
              onAction={() => void stage([f.path])}
              actionLabel="Stage"
              actionIcon={<Plus size={12} aria-hidden="true" />}
            />
          ))}
        </section>
      )}

      {/* Untracked */}
      {s.untracked.length > 0 && (
        <section className="git-section">
          <div className="git-section-header">
            <span>Untracked</span>
            <button
              type="button"
              className="git-section-action"
              onClick={() => void stage(s.untracked.map((f) => f.path))}
              title="Stage all untracked"
            >
              <Plus size={12} aria-hidden="true" />
            </button>
          </div>
          {s.untracked.map((f) => (
            <FileRow
              key={f.path + "-untracked"}
              entry={f}
              statusCode="?"
              selected={selectedPath === f.path}
              onSelect={() => onSelectFile(f.path)}
              onAction={() => void stage([f.path])}
              actionLabel="Stage"
              actionIcon={<Plus size={12} aria-hidden="true" />}
            />
          ))}
        </section>
      )}
    </div>
  );
}
