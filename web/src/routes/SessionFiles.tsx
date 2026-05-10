import { useOutletContext, useSearchParams } from 'react-router';
import { ChevronLeft, Code2, FileCode2, GitCompare, Inbox, Menu } from '../components/icons.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { FileTree } from '../components/FileTree.tsx';
import { MonacoCode } from '../components/MonacoCode.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { fetchDiff, fetchFile } from '../lib/api.ts';
import type { SessionInfo } from '../../../src/types.ts';
import { useState } from 'react';

interface OutletCtx {
  session: SessionInfo;
}

export function SessionFiles() {
  const { session } = useOutletContext<OutletCtx>();
  const [params, setParams] = useSearchParams();
  const [treeOpen, setTreeOpen] = useState(false);

  const filePath = params.get('file');
  const isDiff = params.get('view') === 'diff';

  const file = useAsync(
    async (signal) => (filePath ? fetchFile(filePath, signal) : null),
    [filePath],
  );
  const diff = useAsync(
    async (signal) => (filePath && isDiff ? fetchDiff(filePath, signal) : null),
    [filePath, isDiff],
  );

  const setFile = (path: string) => {
    const sp = new URLSearchParams(params);
    sp.set('file', path);
    setParams(sp, { replace: false });
    setTreeOpen(false);
  };

  const toggleDiff = () => {
    const sp = new URLSearchParams(params);
    if (isDiff) sp.delete('view');
    else sp.set('view', 'diff');
    setParams(sp, { replace: true });
  };

  const fileName = filePath ? filePath.split('/').pop() ?? '' : '';
  const inGit = diff.data?.inGit ?? null;
  const isUntracked = diff.data?.isUntracked ?? false;

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
        action={<button className="btn" onClick={file.reload}>Retry</button>}
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
          action={<button className="btn" onClick={diff.reload}>Retry</button>}
        />
      );
    } else if (diff.data) {
      viewerNode = (
        <MonacoCode
          fileName={fileName}
          diff={{ original: diff.data.original ?? '', modified: diff.data.modified ?? '' }}
        />
      );
    } else {
      viewerNode = null;
    }
  } else {
    viewerNode = <MonacoCode fileName={fileName} code={file.data.content} />;
  }

  let statusLabel = 'No file open';
  if (filePath) {
    statusLabel = filePath;
    if (isDiff) {
      if (inGit === false) statusLabel += '  ·  Not in a git repo';
      else if (isUntracked) statusLabel += '  ·  Untracked file';
      else statusLabel += '  ·  Diff vs HEAD';
    }
  }

  return (
    <section className="tab-pane tab-pane-files">
      <div className="files-toolbar">
        <button
          type="button"
          className="files-tree-toggle"
          aria-label={treeOpen ? 'Hide tree' : 'Show tree'}
          aria-pressed={treeOpen}
          onClick={() => setTreeOpen((v) => !v)}
        >
          {treeOpen ? <ChevronLeft size={14} aria-hidden="true" /> : <Menu size={14} aria-hidden="true" />}
        </button>
        <div className="files-status" aria-live="polite">{statusLabel}</div>
        <button
          type="button"
          className={`btn${isDiff ? ' is-active' : ''}`}
          disabled={!filePath}
          onClick={toggleDiff}
          aria-pressed={isDiff}
        >
          {isDiff ? <Code2 size={14} aria-hidden="true" /> : <GitCompare size={14} aria-hidden="true" />}
          <span>{isDiff ? 'Code' : 'Diff'}</span>
        </button>
      </div>

      <div className={`files-body${treeOpen ? ' tree-open' : ''}`}>
        <aside className="files-tree">
          <FileTree rootPath={session.cwd} selectedPath={filePath} onSelectFile={setFile} />
        </aside>
        <main className="files-viewer">{viewerNode}</main>
      </div>
    </section>
  );
}
