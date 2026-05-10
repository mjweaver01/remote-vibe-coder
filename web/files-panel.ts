// Files panel — Monaco-backed code viewer with a folder tree on the side.
// Monaco loads lazily via its AMD loader the first time the panel mounts.

interface TreeEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface TreeListing {
  cwd: string;
  parent: string | null;
  entries: TreeEntry[];
}

interface FileResp {
  path: string;
  name: string;
  content: string;
  bytes: number;
  truncated: boolean;
  binary: boolean;
}

interface DiffResp {
  path: string;
  original: string;
  modified: string;
  inGit: boolean;
  isUntracked: boolean;
}

type Mode = 'code' | 'diff';

declare global {
  interface Window {
    require: any;
    monaco: any;
  }
}

let monacoReady: Promise<any> | null = null;

function loadMonaco(): Promise<any> {
  if (monacoReady) return monacoReady;
  monacoReady = new Promise((resolve, reject) => {
    if (window.monaco) {
      resolve(window.monaco);
      return;
    }
    const script = document.createElement('script');
    script.src = '/assets/monaco/vs/loader.js';
    script.onload = () => {
      try {
        window.require.config({ paths: { vs: '/assets/monaco/vs' } });
        window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
      } catch (e) {
        reject(e);
      }
    };
    script.onerror = () => reject(new Error('failed to load monaco loader'));
    document.head.appendChild(script);
  });
  return monacoReady;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'html', xml: 'xml', svg: 'xml',
  md: 'markdown', markdown: 'markdown',
  py: 'python', go: 'go', rs: 'rust', rb: 'ruby', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  swift: 'swift', kt: 'kotlin',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  vue: 'html', svelte: 'html',
  dockerfile: 'dockerfile',
};

function languageOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  return LANG_BY_EXT[lower.slice(dot + 1)] ?? 'plaintext';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export class FilesPanel {
  root: HTMLElement;
  private cwd: string;
  private withToken: (path: string) => string;

  private treeEl!: HTMLElement;
  private editorEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private modeBtn!: HTMLButtonElement;
  private treeToggle!: HTMLButtonElement;
  private bodyEl!: HTMLElement;

  private editor: any = null;
  private diffEditor: any = null;
  private currentFile: string | null = null;
  private mode: Mode = 'code';
  private expanded = new Set<string>();
  private childCache = new Map<string, TreeEntry[]>();
  private mounted = false;

  constructor(cwd: string, withToken: (p: string) => string) {
    this.cwd = cwd;
    this.withToken = withToken;
    this.root = document.createElement('div');
    this.root.className = 'files-panel';
    this.root.innerHTML = `
      <div class="files-toolbar">
        <button class="btn icon-only files-tree-toggle" data-act="toggle-tree" aria-label="Toggle tree">≡</button>
        <div class="files-status">no file open</div>
        <button class="btn" data-act="mode" disabled>Diff</button>
      </div>
      <div class="files-body">
        <aside class="files-tree"></aside>
        <main class="files-viewer">
          <div class="files-empty">Select a file from the tree</div>
        </main>
      </div>
    `;
    this.treeEl = this.root.querySelector('.files-tree')!;
    this.editorEl = this.root.querySelector('.files-viewer')!;
    this.statusEl = this.root.querySelector('.files-status')!;
    this.modeBtn = this.root.querySelector('[data-act="mode"]')!;
    this.treeToggle = this.root.querySelector('[data-act="toggle-tree"]')!;
    this.bodyEl = this.root.querySelector('.files-body')!;
  }

  async mount() {
    if (this.mounted) return;
    this.mounted = true;
    this.modeBtn.addEventListener('click', () => this.toggleMode());
    this.treeToggle.addEventListener('click', () => {
      this.bodyEl.classList.toggle('tree-open');
    });
    await this.loadDir(this.cwd, true);
  }

  destroy() {
    this.editor?.dispose();
    this.diffEditor?.dispose();
  }

  /** Called by the parent when the panel becomes visible — gives Monaco a chance to lay out. */
  onShown() {
    requestAnimationFrame(() => {
      this.editor?.layout();
      this.diffEditor?.layout();
    });
  }

  // ---------- Tree ----------

  private async loadDir(absPath: string, isRoot = false): Promise<TreeEntry[]> {
    if (this.childCache.has(absPath)) return this.childCache.get(absPath)!;
    const r = await fetch(this.withToken(`/api/tree?path=${encodeURIComponent(absPath)}`));
    if (!r.ok) throw new Error(await r.text());
    const data = (await r.json()) as TreeListing;
    this.childCache.set(absPath, data.entries);
    if (isRoot) this.renderTree();
    return data.entries;
  }

  private async renderTree() {
    const rootEntries = this.childCache.get(this.cwd) ?? [];
    const lines: string[] = [];
    lines.push(`<div class="tree-row tree-root">${escapeHtml(this.cwd.split('/').pop() || this.cwd)}</div>`);
    for (const e of rootEntries) lines.push(this.renderNode(e, 0));
    this.treeEl.innerHTML = lines.join('');
    this.wireTreeHandlers();
  }

  private renderNode(entry: TreeEntry, depth: number): string {
    const isOpen = this.expanded.has(entry.path);
    const indent = depth * 14;
    const icon = entry.isDir ? (isOpen ? '▾' : '▸') : '';
    const fileIcon = entry.isDir ? '📁' : '📄';
    const isSelected = this.currentFile === entry.path;
    const cls = `tree-row${entry.isDir ? ' is-dir' : ' is-file'}${isSelected ? ' is-selected' : ''}`;
    let html = `<div class="${cls}" data-path="${escapeAttr(entry.path)}" data-is-dir="${entry.isDir}" style="padding-left:${8 + indent}px">
      <span class="tree-arrow">${icon}</span>
      <span class="tree-icon">${fileIcon}</span>
      <span class="tree-name">${escapeHtml(entry.name)}</span>
    </div>`;
    if (entry.isDir && isOpen) {
      const children = this.childCache.get(entry.path);
      if (children) {
        for (const c of children) html += this.renderNode(c, depth + 1);
      } else {
        html += `<div class="tree-row tree-loading" style="padding-left:${8 + (depth + 1) * 14}px">…</div>`;
      }
    }
    return html;
  }

  private wireTreeHandlers() {
    this.treeEl.querySelectorAll<HTMLElement>('.tree-row[data-path]').forEach((row) => {
      row.addEventListener('click', async () => {
        const p = row.getAttribute('data-path')!;
        const isDir = row.getAttribute('data-is-dir') === 'true';
        if (isDir) {
          if (this.expanded.has(p)) {
            this.expanded.delete(p);
          } else {
            this.expanded.add(p);
            try {
              await this.loadDir(p);
            } catch (err) {
              console.error('[files] tree fetch error', err);
            }
          }
          this.renderTree();
        } else {
          this.bodyEl.classList.remove('tree-open');
          await this.openFile(p);
        }
      });
    });
  }

  // ---------- Editor ----------

  private async openFile(path: string) {
    this.currentFile = path;
    this.statusEl.textContent = path;
    this.modeBtn.disabled = false;
    this.renderTree();
    if (this.mode === 'diff') await this.showDiff(path);
    else await this.showCode(path);
  }

  private async showCode(path: string) {
    try {
      const r = await fetch(this.withToken(`/api/file?path=${encodeURIComponent(path)}`));
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as FileResp;
      const monaco = await loadMonaco();

      // Tear down previous editor(s)
      if (this.diffEditor) {
        this.diffEditor.dispose();
        this.diffEditor = null;
      }
      this.editorEl.innerHTML = '';

      if (data.binary) {
        this.editorEl.innerHTML = `<div class="files-empty">Binary file (${(data.bytes / 1024).toFixed(0)} KB)</div>`;
        return;
      }

      if (!this.editor) {
        this.editor = monaco.editor.create(this.editorEl, {
          value: data.content,
          language: languageOf(data.name),
          readOnly: true,
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: window.innerWidth >= 1024 },
          scrollBeyondLastLine: false,
          fontSize: 13,
          renderWhitespace: 'selection',
        });
      } else {
        this.editorEl.appendChild(this.editor.getDomNode() ?? document.createElement('div'));
        const model = monaco.editor.createModel(data.content, languageOf(data.name));
        this.editor.setModel(model);
      }
      requestAnimationFrame(() => this.editor?.layout());
    } catch (err) {
      this.editorEl.innerHTML = `<div class="files-empty">Could not open file: ${escapeHtml(String(err))}</div>`;
    }
  }

  private async showDiff(path: string) {
    try {
      const r = await fetch(this.withToken(`/api/diff?path=${encodeURIComponent(path)}`));
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as DiffResp;
      const monaco = await loadMonaco();

      if (this.editor) {
        this.editor.dispose();
        this.editor = null;
      }
      this.editorEl.innerHTML = '';

      const diffContainer = document.createElement('div');
      diffContainer.style.position = 'absolute';
      diffContainer.style.inset = '0';
      this.editorEl.appendChild(diffContainer);

      this.diffEditor = monaco.editor.createDiffEditor(diffContainer, {
        readOnly: true,
        theme: 'vs-dark',
        automaticLayout: true,
        renderSideBySide: window.innerWidth >= 900,
        scrollBeyondLastLine: false,
        fontSize: 13,
      });
      const lang = languageOf(path.split('/').pop() ?? '');
      const original = monaco.editor.createModel(data.original ?? '', lang);
      const modified = monaco.editor.createModel(data.modified ?? '', lang);
      this.diffEditor.setModel({ original, modified });

      let label = 'Diff vs HEAD';
      if (!data.inGit) label = 'Not in a git repo — current contents';
      else if (data.isUntracked) label = 'Untracked file (no HEAD version)';
      this.statusEl.textContent = `${path}  ·  ${label}`;
    } catch (err) {
      this.editorEl.innerHTML = `<div class="files-empty">Could not load diff: ${escapeHtml(String(err))}</div>`;
    }
  }

  private async toggleMode() {
    if (!this.currentFile) return;
    this.mode = this.mode === 'code' ? 'diff' : 'code';
    this.modeBtn.textContent = this.mode === 'code' ? 'Diff' : 'Code';
    if (this.mode === 'diff') await this.showDiff(this.currentFile);
    else await this.showCode(this.currentFile);
  }
}
