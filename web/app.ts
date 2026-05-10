import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { FilesPanel } from './files-panel.ts';
import type {
  ClientMessage,
  CreateMode,
  FolderEntry,
  PastSessionInfo,
  ServerMessage,
  SessionInfo,
} from '../src/types.ts';

interface FolderListing {
  cwd: string;
  cwdLabel: string;
  parent: string | null;
  entries: FolderEntry[];
}

const TOKEN_KEY = 'rvc.token';

function readToken(): string | null {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    url.searchParams.delete('token');
    history.replaceState({}, '', url.toString() + (location.hash || ''));
    return fromUrl;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

const token = readToken();

function withToken(url: string): string {
  if (!token) return url;
  const u = new URL(url, location.origin);
  u.searchParams.set('token', token);
  return u.pathname + u.search;
}

const app = document.getElementById('app')!;

let ws: WebSocket | null = null;
let connected = false;
let sessions: SessionInfo[] = [];
let banner: HTMLElement | null = null;

const sessionListeners = new Set<(s: SessionInfo[]) => void>();

function connectWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = new URL(`${proto}://${location.host}/ws`);
    if (token) url.searchParams.set('token', token);
    const sock = new WebSocket(url.toString());
    sock.addEventListener('open', () => {
      connected = true;
      clearBanner();
      resolve(sock);
    });
    sock.addEventListener('error', () => reject(new Error('ws error')));
    sock.addEventListener('close', () => {
      connected = false;
      showBanner('Disconnected. Reconnecting…', 'error');
      setTimeout(boot, 1500);
    });
    sock.addEventListener('message', (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleServerMessage(msg);
    });
  });
}

function send(msg: ClientMessage) {
  if (ws && connected) ws.send(JSON.stringify(msg));
}

function handleServerMessage(msg: ServerMessage) {
  if (msg.type === 'sessions') {
    sessions = msg.sessions;
    sessionListeners.forEach((fn) => fn(sessions));
    return;
  }
  // Other message types are routed by view-specific listeners (added on attach)
  routeRouted(msg);
}

const routedListeners = new Set<(m: ServerMessage) => void>();
function routeRouted(m: ServerMessage) {
  routedListeners.forEach((l) => l(m));
}

function showBanner(text: string, kind: '' | 'error' = '') {
  if (!banner) {
    banner = document.createElement('div');
    document.body.prepend(banner);
  }
  banner.className = `banner${kind ? ' ' + kind : ''}`;
  banner.textContent = text;
}
function clearBanner() {
  if (banner) banner.remove();
  banner = null;
}

// ---------- Router ----------

interface View {
  root: HTMLElement;
  mount(): void;
  destroy(): void;
}

let currentView: View | null = null;
function setView(v: View) {
  if (currentView) currentView.destroy();
  app.innerHTML = '';
  app.appendChild(v.root);
  currentView = v;
  v.mount();
}

function navigate(hash: string) {
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

function renderRoute() {
  const h = location.hash || '#/';
  let m = h.match(/^#\/s\/([a-zA-Z0-9_-]+)$/);
  if (m) {
    setView(new TerminalView(m[1]!));
    return;
  }
  m = h.match(/^#\/p\/(.+)$/);
  if (m) {
    let cwd: string;
    try {
      cwd = decodeURIComponent(m[1]!);
    } catch {
      cwd = m[1]!;
    }
    setView(new SessionPickerView(cwd));
    return;
  }
  setView(new BrowserView());
}

window.addEventListener('hashchange', renderRoute);

// ---------- Browser view ----------

class BrowserView implements View {
  root: HTMLElement;
  private listEl: HTMLElement;
  private crumbsEl: HTMLElement;
  private path: string | null = null;
  private listing: FolderListing | null = null;
  private unsub: () => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.style.display = 'contents';
    this.root.innerHTML = `
      <div class="topbar">
        <div class="title">remote-vibe-coder</div>
        <div class="crumbs"></div>
      </div>
      <div class="browser">
        <div class="list"></div>
      </div>
    `;
    this.crumbsEl = this.root.querySelector('.crumbs')!;
    this.listEl = this.root.querySelector('.list')!;
  }

  mount() {
    const fn = (s: SessionInfo[]) => this.render();
    sessionListeners.add(fn);
    this.unsub = () => sessionListeners.delete(fn);
    this.load();
  }

  destroy() {
    this.unsub();
  }

  async load(path?: string) {
    try {
      const url = withToken(path ? `/api/folders?path=${encodeURIComponent(path)}` : '/api/folders');
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.text());
      this.listing = await r.json();
      this.path = this.listing!.cwd;
      this.render();
    } catch (err) {
      this.listEl.innerHTML = `<div class="empty">Could not load folder: ${escapeHtml(String(err))}</div>`;
    }
  }

  private render() {
    if (!this.listing) return;
    const { entries, parent, cwdLabel } = this.listing;
    this.crumbsEl.textContent = cwdLabel;

    const parts: string[] = [];

    if (sessions.length > 0) {
      parts.push(`<div class="section-title">Active sessions · tap to attach</div>`);
      for (const s of sessions) {
        parts.push(`
          <div class="row session-row" data-session="${s.id}">
            <span class="icon">●</span>
            <span class="name">${escapeHtml(s.cwdLabel)}</span>
            <span class="badge">${s.viewers} viewer${s.viewers === 1 ? '' : 's'}</span>
            <span class="chev">›</span>
          </div>`);
      }
    }

    parts.push(`<div class="section-title">${escapeHtml(cwdLabel)}</div>`);

    if (parent) {
      parts.push(`
        <div class="row" data-cd="${escapeAttr(parent)}">
          <span class="icon">↩</span>
          <span class="name">..</span>
          <span class="chev">›</span>
        </div>`);
    }

    if (entries.length === 0) {
      parts.push(`<div class="empty">No subfolders here. Try a different folder, or pass --root to choose another root.</div>`);
    } else {
      for (const e of entries) {
        parts.push(`
          <div class="row" data-cd="${escapeAttr(e.path)}">
            <span class="icon">📁</span>
            <span class="name">${escapeHtml(e.name)}</span>
            <button class="open-btn" data-pick="${escapeAttr(e.path)}" title="Open or resume here">▸</button>
            <span class="chev">›</span>
          </div>`);
      }
    }

    this.listEl.innerHTML = parts.join('');

    this.listEl.querySelectorAll<HTMLElement>('[data-cd]').forEach((row) => {
      row.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('[data-pick]')) return;
        const p = row.getAttribute('data-cd')!;
        this.load(p);
      });
    });
    this.listEl.querySelectorAll<HTMLElement>('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const cwd = btn.getAttribute('data-pick')!;
        navigate(`#/p/${encodeURIComponent(cwd)}`);
      });
    });
    this.listEl.querySelectorAll<HTMLElement>('[data-session]').forEach((row) => {
      row.addEventListener('click', () => {
        navigate(`#/s/${row.getAttribute('data-session')}`);
      });
    });
  }
}

// ---------- Session picker (new + resume from list) ----------

class SessionPickerView implements View {
  root: HTMLElement;
  private cwd: string;
  private listEl!: HTMLElement;
  private busy = false;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.root = document.createElement('div');
    this.root.style.display = 'contents';
    const folderName = cwd.split('/').filter(Boolean).pop() || cwd;
    this.root.innerHTML = `
      <div class="topbar">
        <button class="btn icon-only" data-back aria-label="Back">←</button>
        <div class="crumbs"><strong>${escapeHtml(folderName)}</strong> <span style="opacity:.6">${escapeHtml(cwd)}</span></div>
      </div>
      <div class="picker">
        <div class="picker-actions">
          <button class="btn primary big" data-act="new">＋ New conversation</button>
          <button class="btn big" data-act="continue">↻ Continue last</button>
        </div>
        <div class="section-title">Past conversations</div>
        <div class="picker-list"><div class="empty">Loading…</div></div>
      </div>
    `;
    this.listEl = this.root.querySelector('.picker-list')!;
  }

  mount() {
    this.root.querySelector<HTMLElement>('[data-back]')!.addEventListener('click', () => {
      navigate('#/');
    });
    this.root.querySelectorAll<HTMLElement>('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-act')!;
        if (act === 'new') this.startSession({ kind: 'new' });
        else if (act === 'continue') this.startSession({ kind: 'continue' });
      });
    });
    this.loadHistory();
  }

  destroy() {}

  private async loadHistory() {
    try {
      const r = await fetch(withToken(`/api/history?path=${encodeURIComponent(this.cwd)}`));
      if (!r.ok) throw new Error(await r.text());
      const { sessions: list } = (await r.json()) as { sessions: PastSessionInfo[] };
      this.renderHistory(list);
    } catch (err) {
      this.listEl.innerHTML = `<div class="empty">Could not load history: ${escapeHtml(String(err))}</div>`;
    }
  }

  private renderHistory(list: PastSessionInfo[]) {
    if (list.length === 0) {
      this.listEl.innerHTML = `<div class="empty">No past conversations in this folder yet.</div>`;
      this.disableContinue();
      return;
    }
    const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const now = Date.now();
    const rows = list.map((s) => {
      const ageMs = now - s.mtime;
      const age = relTime(ageMs, fmt);
      const sizeKb = (s.sizeBytes / 1024).toFixed(0);
      return `
        <div class="row history-row" data-resume="${escapeAttr(s.id)}">
          <span class="name">${escapeHtml(s.preview || '(no preview)')}</span>
          <span class="meta">${escapeHtml(age)} · ${sizeKb} KB</span>
          <span class="chev">›</span>
        </div>`;
    });
    this.listEl.innerHTML = rows.join('');
    this.listEl.querySelectorAll<HTMLElement>('[data-resume]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-resume')!;
        this.startSession({ kind: 'resume', conversationId: id });
      });
    });
  }

  private disableContinue() {
    const btn = this.root.querySelector<HTMLButtonElement>('[data-act="continue"]');
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.4';
      btn.title = 'No previous conversation to continue';
    }
  }

  private startSession(mode: CreateMode) {
    if (this.busy) return;
    this.busy = true;
    const { cols, rows } = approxTerminalSize();
    const onMsg = (m: ServerMessage) => {
      if (m.type === 'created') {
        routedListeners.delete(onMsg);
        navigate(`#/s/${m.session.id}`);
      } else if (m.type === 'error') {
        routedListeners.delete(onMsg);
        this.busy = false;
        showBanner(m.message, 'error');
      }
    };
    routedListeners.add(onMsg);
    send({ type: 'create', cwd: this.cwd, cols, rows, mode });
  }
}

function relTime(ms: number, fmt: Intl.RelativeTimeFormat): string {
  const sec = Math.round(-ms / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return fmt.format(sec, 'second');
  if (abs < 3600) return fmt.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return fmt.format(Math.round(sec / 3600), 'hour');
  if (abs < 86400 * 30) return fmt.format(Math.round(sec / 86400), 'day');
  if (abs < 86400 * 365) return fmt.format(Math.round(sec / (86400 * 30)), 'month');
  return fmt.format(Math.round(sec / (86400 * 365)), 'year');
}

// ---------- Terminal view ----------

class TerminalView implements View {
  private sessionId: string;
  root: HTMLElement;
  private term: Terminal;
  private fit: FitAddon;
  private termHost!: HTMLElement;
  private kbdTrap!: HTMLInputElement;
  private resizeObs!: ResizeObserver;
  private listener: (m: ServerMessage) => void = () => {};
  private offDataDispose: { dispose: () => void } = { dispose: () => {} };
  private filesPanel: FilesPanel | null = null;
  private activeTab: 'term' | 'files' = 'term';

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.root = document.createElement('div');
    this.root.style.display = 'contents';
    this.root.innerHTML = `
      <div class="topbar">
        <button class="btn icon-only" data-back aria-label="Back">←</button>
        <div class="crumbs">session ${this.shortId()} · loading…</div>
        <button class="btn danger" data-kill>Kill</button>
      </div>
      <div class="tabstrip">
        <button class="tab-btn is-active" data-tab="term">▣ Terminal</button>
        <button class="tab-btn" data-tab="files">📁 Files</button>
      </div>
      <div class="session" data-active-tab="term">
        <div class="term-panel">
          <div class="term-host"><div id="xterm"></div></div>
          <div class="keybar">
            <button data-key="1" title="Yes">1</button>
            <button data-key="2" title="No">2</button>
            <button data-key="3" title="Other">3</button>
            <button data-key="Enter">⏎</button>
            <button data-key="Esc">Esc</button>
            <button data-key="Tab">Tab</button>
            <button data-key="Up">↑</button>
            <button data-key="Down">↓</button>
            <button data-key="Left">←</button>
            <button data-key="Right">→</button>
            <button data-key="CtrlC">Ctrl+C</button>
            <button data-key="kbd">⌨</button>
          </div>
          <input class="kbd-trap" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" />
        </div>
        <div class="files-panel-host"></div>
      </div>
    `;

    this.term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      theme: {
        background: '#000000',
        foreground: '#e9e9ec',
        cursor: '#ff8a4c',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(255,138,76,0.35)',
      },
      allowProposedApi: true,
      scrollback: 5000,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon());
  }

  mount() {
    this.termHost = this.root.querySelector('.term-host')!;
    this.kbdTrap = this.root.querySelector('.kbd-trap')!;
    this.term.open(this.root.querySelector('#xterm')!);
    this.term.focus();

    // Tab switching
    const sessionEl = this.root.querySelector<HTMLElement>('.session')!;
    this.root.querySelectorAll<HTMLElement>('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') as 'term' | 'files';
        this.switchTab(tab, sessionEl);
      });
    });

    // Mount files panel lazily on first switch (do scaffolding now, content on demand)
    const filesHost = this.root.querySelector<HTMLElement>('.files-panel-host')!;
    const cwd = this.lookupCwd();
    if (cwd) {
      this.filesPanel = new FilesPanel(cwd, withToken);
      filesHost.appendChild(this.filesPanel.root);
    } else {
      filesHost.innerHTML = `<div class="files-empty">cwd unknown — wait for session info</div>`;
    }

    this.offDataDispose = this.term.onData((d) => {
      send({ type: 'input', sessionId: this.sessionId, data: d });
    });

    this.resizeObs = new ResizeObserver(() => this.refit());
    this.resizeObs.observe(this.termHost);
    requestAnimationFrame(() => this.refit());

    // Wire toolbar
    this.root.querySelector<HTMLElement>('[data-back]')!.addEventListener('click', () => {
      send({ type: 'detach', sessionId: this.sessionId });
      navigate('#/');
    });
    this.root.querySelector<HTMLElement>('[data-kill]')!.addEventListener('click', () => {
      if (confirm('Kill this Claude session?')) {
        send({ type: 'kill', sessionId: this.sessionId });
      }
    });
    this.root.querySelectorAll<HTMLElement>('[data-key]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleKeybarTap(b.getAttribute('data-key')!);
      });
    });

    // Update crumbs from sessions list
    sessionListeners.add(this.updateCrumbs);
    this.updateCrumbs(sessions);

    // Server messages
    this.listener = (m: ServerMessage) => this.handle(m);
    routedListeners.add(this.listener);

    // Join the session
    const { cols, rows } = approxTerminalSize();
    send({ type: 'join', sessionId: this.sessionId, cols, rows });
  }

  private updateCrumbs = (list: SessionInfo[]) => {
    const me = list.find((s) => s.id === this.sessionId);
    const crumbs = this.root.querySelector('.crumbs');
    if (!crumbs) return;
    if (me) crumbs.textContent = `${me.cwdLabel} · ${me.viewers} viewer${me.viewers === 1 ? '' : 's'}`;
    else crumbs.textContent = `session ${this.shortId()} · ended`;
  };

  private handle(m: ServerMessage) {
    if (m.type === 'attached' && m.sessionId === this.sessionId) {
      if (m.replay) this.term.write(m.replay);
      this.refit();
    } else if (m.type === 'output' && m.sessionId === this.sessionId) {
      this.term.write(m.data);
    } else if (m.type === 'ended' && m.sessionId === this.sessionId) {
      this.term.write(`\r\n\x1b[33m[session ended — exit ${m.exitCode}]\x1b[0m\r\n`);
    } else if (m.type === 'error') {
      this.term.write(`\r\n\x1b[31m[error: ${m.message}]\x1b[0m\r\n`);
    }
  }

  private refit() {
    try {
      this.fit.fit();
      const cols = this.term.cols;
      const rows = this.term.rows;
      send({ type: 'resize', sessionId: this.sessionId, cols, rows });
    } catch {}
  }

  private handleKeybarTap(key: string) {
    const map: Record<string, string> = {
      Esc: '\x1b',
      Tab: '\t',
      Up: '\x1b[A',
      Down: '\x1b[B',
      Left: '\x1b[D',
      Right: '\x1b[C',
      Enter: '\r',
      CtrlC: '\x03',
      '1': '1',
      '2': '2',
      '3': '3',
    };
    if (key === 'kbd') {
      this.kbdTrap.focus();
      // Forward keystrokes from the trap to the terminal
      const onInput = () => {
        const v = this.kbdTrap.value;
        if (v) {
          send({ type: 'input', sessionId: this.sessionId, data: v });
          this.kbdTrap.value = '';
        }
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          send({ type: 'input', sessionId: this.sessionId, data: '\r' });
        } else if (e.key === 'Backspace' && !this.kbdTrap.value) {
          send({ type: 'input', sessionId: this.sessionId, data: '\x7f' });
        }
      };
      this.kbdTrap.addEventListener('input', onInput);
      this.kbdTrap.addEventListener('keydown', onKey);
      this.kbdTrap.addEventListener('blur', () => {
        this.kbdTrap.removeEventListener('input', onInput);
        this.kbdTrap.removeEventListener('keydown', onKey);
      }, { once: true });
      return;
    }
    const seq = map[key];
    if (seq) send({ type: 'input', sessionId: this.sessionId, data: seq });
  }

  private shortId() {
    return this.sessionId.slice(0, 6);
  }

  private switchTab(tab: 'term' | 'files', sessionEl: HTMLElement) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    sessionEl.setAttribute('data-active-tab', tab);
    this.root.querySelectorAll<HTMLElement>('.tab-btn').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === tab);
    });
    if (tab === 'files' && this.filesPanel) {
      this.filesPanel.mount().catch((e) => console.error('[files-panel mount]', e));
      this.filesPanel.onShown();
    }
    if (tab === 'term') {
      requestAnimationFrame(() => this.refit());
      this.term.focus();
    }
  }

  private lookupCwd(): string | null {
    const me = sessions.find((s) => s.id === this.sessionId);
    return me?.cwd ?? null;
  }

  destroy() {
    sessionListeners.delete(this.updateCrumbs);
    routedListeners.delete(this.listener);
    this.resizeObs?.disconnect();
    this.offDataDispose.dispose();
    this.term.dispose();
    this.filesPanel?.destroy();
  }
}

function approxTerminalSize(): { cols: number; rows: number } {
  // Heuristic — refit() will correct after mount
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cols = Math.max(40, Math.floor(w / 8));
  const rows = Math.max(12, Math.floor((h - 110) / 17));
  return { cols, rows };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}

async function boot() {
  try {
    showBanner('Connecting…');
    ws = await connectWs();
    renderRoute();
  } catch {
    showBanner('Could not connect. Retrying…', 'error');
    setTimeout(boot, 2000);
  }
}

boot();
