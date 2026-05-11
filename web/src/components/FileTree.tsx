import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, File as FileIcon, Folder, Inbox, Loader2 } from "./icons.ts";
import { fetchTree, type TreeEntry } from "../lib/api.ts";
import { EmptyState } from "./EmptyState.tsx";

const MAX_TREE_DEPTH = 50;

interface NodeState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  children: TreeEntry[];
}

interface Props {
  rootPath: string;
  selectedPath: string | null;
  onSelectFile(path: string): void;
  changedPaths?: Set<string>;
}

export function FileTree({ rootPath, selectedPath, onSelectFile, changedPaths }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([rootPath]));
  const [nodes, setNodes] = useState<Map<string, NodeState>>(() => new Map());

  const loadDir = useCallback(async (absPath: string) => {
    setNodes((prev) => {
      const next = new Map(prev);
      next.set(absPath, { loaded: false, loading: true, error: null, children: [] });
      return next;
    });
    try {
      const data = await fetchTree(absPath);
      setNodes((prev) => {
        const next = new Map(prev);
        next.set(absPath, { loaded: true, loading: false, error: null, children: data.entries });
        return next;
      });
    } catch (err) {
      setNodes((prev) => {
        const next = new Map(prev);
        next.set(absPath, {
          loaded: false,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          children: [],
        });
        return next;
      });
    }
  }, []);

  // Load root on mount + reload when rootPath changes
  useEffect(() => {
    setExpanded(new Set([rootPath]));
    setNodes(new Map());
    void loadDir(rootPath);
  }, [rootPath, loadDir]);

  const toggleDir = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!nodes.has(path)) void loadDir(path);
    }
    setExpanded(next);
  };

  const renderNode = (entry: TreeEntry, depth: number) => {
    if (depth > MAX_TREE_DEPTH) return null;
    const isOpen = expanded.has(entry.path);
    const isSelected = selectedPath === entry.path;
    const isChanged = !entry.isDir && (changedPaths?.has(entry.path) ?? false);
    const node = nodes.get(entry.path);

    return (
      <div key={entry.path} className="tree-node">
        <button
          type="button"
          className={`tree-row${entry.isDir ? " is-dir" : " is-file"}${isSelected ? " is-selected" : ""}${isChanged ? " is-changed" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (entry.isDir ? toggleDir(entry.path) : onSelectFile(entry.path))}
        >
          <span className="tree-arrow">
            {entry.isDir ? (
              isOpen ? (
                <ChevronDown size={12} aria-hidden="true" />
              ) : (
                <ChevronRight size={12} aria-hidden="true" />
              )
            ) : (
              <span className="tree-arrow-empty" aria-hidden="true" />
            )}
          </span>
          <span
            className={`tree-icon${entry.isDir ? " tree-icon-dir" : " tree-icon-file"}`}
            aria-hidden="true"
          >
            {entry.isDir ? <Folder size={14} /> : <FileIcon size={14} />}
          </span>
          <span className="tree-name">{entry.name}</span>
          {isChanged && <span className="tree-changed-dot" aria-hidden="true" />}
        </button>

        {entry.isDir && isOpen ? (
          <div className="tree-children">
            {node?.loading ? (
              <div className="tree-row tree-loading" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                <Loader2 size={12} className="spin" aria-hidden="true" />
                <span>Loading…</span>
              </div>
            ) : node?.error ? (
              <div className="tree-row tree-error" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                {node.error}
              </div>
            ) : node?.children.length === 0 ? (
              <div className="tree-row tree-empty" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                empty
              </div>
            ) : (
              node?.children.map((c) => renderNode(c, depth + 1))
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const root = nodes.get(rootPath);

  if (!root) {
    return (
      <div className="tree-loading-root">
        <Loader2 size={14} className="spin" aria-hidden="true" />
        <span>Loading tree…</span>
      </div>
    );
  }

  if (root.error) {
    return (
      <EmptyState
        icon={Inbox}
        tone="error"
        title="Couldn't read the tree"
        description={<code className="empty-state-detail">{root.error}</code>}
        action={
          <button type="button" className="btn" onClick={() => loadDir(rootPath)}>
            Retry
          </button>
        }
      />
    );
  }

  return (
    <div className="tree" role="tree">
      <div className="tree-root-label">{rootPath.split("/").pop() ?? rootPath}</div>
      {root.children.map((c) => renderNode(c, 0))}
    </div>
  );
}
