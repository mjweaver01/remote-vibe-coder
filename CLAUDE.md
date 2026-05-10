# remote-vibe-coder — Engineering Reference

> **Audience:** Engineers and AI agents adding features, fixing bugs, or reviewing this codebase.  
> This document is the authoritative source on architecture, conventions, and intent.

---

## What This Is

A local web server that wraps the real `claude` CLI in a PTY and serves it to any browser on the network — laptop, phone, tablet. The headline feature is **cross-device handoff**: start a Claude Code session on your laptop, walk away, and answer permission prompts from your phone. Sessions live on the server, not in the browser.

Distributed as an npm package: `npx remote-vibe-coder --root ~/Websites`.

---

## Architecture

```
┌─────────────────────────┐     HTTP + WS      ┌───────────────────────────────────┐
│  Browser (any device)   │ ◀────────────────▶ │  Node server (this package)       │
│                         │                     │                                   │
│  React 19 SPA           │                     │  http.createServer                │
│  xterm.js terminal      │                     │  WebSocketServer (ws)             │
│  Monaco editor          │                     │  SessionManager (node-pty)        │
│  Voice input (Web API)  │                     │  REST API: /api/*                 │
└─────────────────────────┘                     └───────────────────────────────────┘
```

### Server

**Runtime:** Node 25+.

The server is a single `http.createServer` instance with a `WebSocketServer` (from `ws`) sharing the same port via `server.on('upgrade')`. There is no Express, no framework. All routing is a chain of `if (url.pathname === ...)` checks in `handleHttp`.

Static assets are served from `dist/web/` (built by Vite). Any unrecognised path returns `index.html` (SPA fallback).

### Client

**React 19** SPA, built with **Vite**. Single `createRoot` entry point. Client-side routing via **React Router 7** (`createBrowserRouter`). All view state is URL-encoded — reloading the page restores the exact view.

---

## Stack

| Concern        | Tool                                           | Why                                                               |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Runtime        | Node 25+                                       | `node-pty` requires Node's libuv I/O loop                         |
| Server HTTP/WS | `http` + `ws`                                  | No framework overhead; full control                               |
| PTY            | `node-pty`                                     | Standard; prebuilt N-API binaries                                 |
| Client build   | Vite + `@vitejs/plugin-react`                  | Fast HMR in dev, clean prod bundles                               |
| Server build   | esbuild (via `src/build.ts`)                   | Transpiles server TS to single Node ESM bundle                    |
| Dev runner     | `src/dev.ts`                                   | Spawns `vite build --watch` + `tsx watch src/cli.ts` concurrently |
| UI framework   | React 19                                       | Latest; concurrent features available                             |
| Routing        | React Router 7                                 | File-based-style nested routes; URL-first state                   |
| Icons          | Lucide React                                   | Consistent; tree-shakeable; no emoji/unicode                      |
| Terminal       | `@xterm/xterm` + FitAddon + WebLinksAddon      | Real xterm.js — same renderer Claude Code uses                    |
| Code editor    | Monaco (AMD loader via `min/vs/loader.js`)     | VSCode's editor; lazy-loaded on first Files tab open              |
| Voice          | Web Speech API (`SpeechRecognition`)           | Native browser API; no model download, no external dependency     |
| Formatting     | Prettier                                       | See `.prettierrc` — 2-space, double quotes, 100-char lines        |
| Types          | TypeScript strict + `noUncheckedIndexedAccess` | Catches index-access bugs at compile time                         |

---

## Repository Layout

```
remote-vibe-coder/
├── src/                        # Node server (TypeScript ESM)
│   ├── cli.ts                  # Entry point: flag parsing, QR banner, SIGINT handler
│   ├── server.ts               # HTTP routes + WebSocket upgrade + request auth
│   ├── sessions.ts             # PTY lifecycle: create/attach/detach/resize/kill
│   ├── files.ts                # Sandboxed folder listing (/api/folders)
│   ├── code.ts                 # File read, git diff, tree listing (/api/file, /api/diff, /api/tree)
│   ├── git.ts                  # Git status/stage/unstage/commit (/api/git/*)
│   ├── history.ts              # Past Claude conversations from ~/.claude/projects/
│   ├── auth.ts                 # Token generation + constant-time compare
│   ├── types.ts                # WebSocket protocol types (shared with web/)
│   ├── build.ts                # esbuild: bundles server → dist/cli.js
│   └── dev.ts                  # Dev runner: vite watch + tsx watch, colour-tagged output
│
├── web/                        # React SPA (Vite project root)
│   ├── index.html              # Single shell; script type=module → /assets/app.js
│   └── src/
│       ├── styles.css          # Hand-rolled mobile-first dark CSS; no Tailwind
│       ├── main.tsx            # createRoot → RouterProvider
│       ├── router.tsx          # createBrowserRouter — route definitions
│       ├── App.tsx             # WsProvider > ToastProvider > app-shell > Outlet
│       ├── routes/             # One component per route (see Route Map below)
│       ├── components/         # Shared UI components (see Component Inventory below)
│       ├── hooks/              # Custom React hooks
│       ├── lib/                # Pure TS modules (api, ws, auth, monaco)
│       └── providers/          # WsProvider, ToastProvider (React context)
│
├── vite.config.ts              # Vite config (root: web/, outDir: dist/web/)
├── tsconfig.json               # Strict TS; covers both src/ and web/src/
├── .prettierrc                 # 2-space, double quotes, 100-char, trailingComma: es5
└── package.json                # bin: remote-vibe-coder → dist/cli.js
```

---

## Route Map

| URL pattern             | Component         | Purpose                                                    |
| ----------------------- | ----------------- | ---------------------------------------------------------- |
| `/`                     | `BrowserPage`     | Folder browser; active sessions list; folder filter search |
| `/p/:cwd`               | `PickerPage`      | New / continue / resume conversation for a specific folder |
| `/s/:sessionId`         | `SessionPage`     | Shell: topbar, tab strip (Terminal / Files), outlet        |
| `/s/:sessionId` (index) | `SessionTerminal` | xterm.js attached to the PTY; Keybar; voice input          |
| `/s/:sessionId/files`   | `SessionFiles`    | FileTree + Monaco viewer + git diff toggle                 |
| `*`                     | `NotFoundPage`    | 404                                                        |

**Navigation conventions:**

- Back from `SessionPage` → `/p/:cwd` (picker for that folder)
- Kill session → immediately navigate to `/p/:cwd`
- Opening a folder from `BrowserPage` → `/p/:encodedCwd`

---

## Component Inventory

### `web/src/components/`

| File                   | What it does                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icons.ts`             | **Single source of truth** for all Lucide icons. Import icons here; never import directly from `lucide-react` in other files.                                                                 |
| `ConnectionBanner.tsx` | Sticky banner shown when WS is connecting or disconnected. Disappears when connected.                                                                                                         |
| `EmptyState.tsx`       | Reusable empty/error state: icon + title + optional description + optional action. Accepts `tone="error"`.                                                                                    |
| `ErrorBoundary.tsx`    | React error boundary wrapping the main outlet.                                                                                                                                                |
| `FileTree.tsx`         | Lazy-loading recursive file tree. Loads one directory at a time on expand.                                                                                                                    |
| `GitPanel.tsx`         | Git status panel: staged/unstaged/untracked file lists with stage/unstage actions and commit form.                                                                                            |
| `IconButton.tsx`       | Square icon-only button with `tone` (default/primary/danger) and `size` (sm/md).                                                                                                              |
| `Keybar.tsx`           | Terminal key bar. **Desktop:** horizontal scroll strip. **Mobile (≤767px):** gameboy layout — Up arrow left, 1/2/3/Enter diamond centre, secondary controls (Esc/Tab/voice/kbd/Ctrl+C) right. |
| `LoadingState.tsx`     | Centred spinner + label for async loading states.                                                                                                                                             |
| `MonacoCode.tsx`       | Monaco editor wrapper. Accepts `code` (plain) or `diff: {original, modified}` (DiffEditor). AMD loader injected once; cached Promise.                                                         |
| `Topbar.tsx`           | Page header: leading slot, title/subtitle, trailing slot. Sticky, safe-area-aware.                                                                                                            |
| `ToastViewport.tsx`    | Fixed toast container (bottom-right on desktop, full-width on mobile).                                                                                                                        |
| `VoiceButton.tsx`      | Mic button: uses browser Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`) → calls `onText(transcript)`. Hidden when API is unsupported.                                         |
| `XTerm.tsx`            | `forwardRef` xterm.js wrapper. `ResizeObserver` drives `FitAddon.fit()`. Exposes `focus/fit/write` via ref.                                                                                   |

### `web/src/hooks/`

| File             | What it does                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| `useAsync.ts`           | `useAsync(producer, deps)` — runs an async function, manages AbortController, returns `{data, error, loading, reload}`. Use for all API fetches in components. |
| `useSessionActivity.ts` | Tracks recent per-session activity for display in session lists.                                                                                               |
| `useSessions.ts`        | `useSessions()` → live `SessionInfo[]` from WS. `useSession(id)` → single session or `null`.                                                                   |
| `useToast.ts`           | `useToast().push(tone, message)` — imperative toast API.                                                                                                       |
| `useWs.ts`              | `useWs()` → `WsClient` instance. Use `.send(msg)` and `.onMessage(cb)` (returns unsub fn).                                                                     |
| `useWsStatus.ts`        | `useWsStatus()` → `'connecting' \| 'open' \| 'closed'`.                                                                                                       |

### `web/src/lib/`

| File         | What it does                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `api.ts`       | Typed REST client. All functions accept `AbortSignal`. Throws `ApiError` on non-2xx.                                                      |
| `auth.ts`      | `getToken()` reads from URL `?token=` → persists to `sessionStorage`. `withToken(path)` and `wsUrl(path)` append token automatically.     |
| `favorites.ts` | `getFavorites()` / `toggleFavorite()` — persists starred folders to `localStorage` under `rvc:favorites`.                                 |
| `monaco.ts`    | `loadMonaco()` — injects AMD loader, returns cached Promise. `languageForFile(name)` maps extension → Monaco language ID.                 |
| `ws.ts`        | `WsClient` class: auto-reconnect (exponential backoff 500ms→8s), pub-sub for messages/status/sessions. `getWsClient()` returns singleton. |

---

## WebSocket Protocol

All messages are JSON. The protocol types live in `src/types.ts` and are imported by both server and web.

### Client → Server

```ts
{ type: 'list' }
{ type: 'create'; cwd: string; cols: number; rows: number; mode?: CreateMode }
{ type: 'join';   sessionId: string; cols: number; rows: number }
{ type: 'detach'; sessionId: string }
{ type: 'input';  sessionId: string; data: string }
{ type: 'resize'; sessionId: string; cols: number; rows: number }
{ type: 'kill';   sessionId: string }
```

`CreateMode`:

```ts
{
  kind: "new";
} // claude (no flags)
{
  kind: "continue";
} // claude --continue
{
  kind: "resume";
  conversationId: string;
} // claude --resume <id>
```

### Server → Client

```ts
{ type: 'sessions'; sessions: SessionInfo[] }   // broadcast on any change
{ type: 'created';  session: SessionInfo }       // after create
{ type: 'attached'; sessionId: string; replay: string }  // ring buffer on join
{ type: 'output';   sessionId: string; data: string }    // PTY stdout
{ type: 'ended';    sessionId: string; exitCode: number }
{ type: 'error';    message: string }
```

**Session list** is broadcast to every connected WebSocket whenever sessions change (create/attach/detach/end/resize). Clients subscribe via `WsClient.onSessions(cb)`.

---

## PTY Session Model

- PTY lifetime is **independent of WebSocket connections**. Closing a browser tab does not kill Claude.
- **Multiple viewers** can attach to the same `sessionId`. Both see identical output in real time and both can send input.
- **Ring buffer** — last 64 KB of PTY output is stored per session. Replayed verbatim to every new attacher via `attached.replay`. This is how a phone "sees" the current terminal state without the server re-running anything.
- Sessions are in-memory only. A server restart clears all sessions.

---

## REST API

All endpoints require `?token=<value>` when the server was started with a token (non-loopback host).

| Method | Path                 | Description                                                                      |
| ------ | -------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/folders?path=` | List subdirectories under `--root`. Path defaults to `--root`.                   |
| GET    | `/api/tree?path=`    | One directory level for the Files panel tree. Skips `.git`, `node_modules`, etc. |
| GET    | `/api/file?path=`    | Read a file (≤1 MB). Returns `{content, binary, bytes, truncated}`.              |
| GET    | `/api/diff?path=`    | Git diff vs HEAD. Returns `{original, modified, inGit, isUntracked}`.            |
| GET    | `/api/history?path=` | Past Claude conversations for a cwd (reads `~/.claude/projects/`).               |
| GET    | `/api/config`        | `{root, hasToken}` — used by the client to know the server root.                 |
| GET    | `/api/git/status?path=` | Git status for a cwd. Returns `{inGit, root, branch, staged, unstaged, untracked}`. |
| POST   | `/api/git/stage`     | Stage files. Body: `{files: string[]}`.                                          |
| POST   | `/api/git/unstage`   | Unstage files. Body: `{files: string[]}`.                                        |
| POST   | `/api/git/commit`    | Commit staged files. Body: `{cwd, message}`. Returns `{hash}`.                  |
| GET    | `/*`                 | Static assets from `dist/web/`. Unknown paths → `index.html` (SPA fallback).     |

All paths are sandboxed. Any path resolving outside `--root` is rejected with 400.

---

## Development Workflow

### Starting dev mode

```bash
npm run dev
```

This runs `src/dev.ts` which:

1. Checks for `dist/` — runs `npm run build` once if missing.
2. Spawns `vite build --watch` (client, colour-tagged `[client]`).
3. Waits for the first `"built in"` message from Vite, then spawns `tsx watch src/cli.ts` (server, colour-tagged `[server]`).

Both processes share stdout. Edit any file in `web/` → Vite rebuilds the client bundle in ~200ms. Edit any file in `src/` → tsx restarts the server.

### Building for production

```bash
npm run build
```

Two steps in `src/build.ts`:

1. **esbuild** bundles `src/cli.ts` → `dist/cli.js` (Node ESM, externals: `node-pty`, `ws`, `qrcode-terminal`).
2. **Vite** (`vite build`) bundles `web/` → `dist/web/` with fixed asset names (`assets/app.js`).

Then `node dist/cli.js` or `npx remote-vibe-coder`.

### Type checking

```bash
npx tsc --noEmit
```

`tsconfig.json` covers both `src/` and `web/src/`. Fix type errors before shipping.

### Formatting

```bash
npx prettier --write .
```

`.prettierrc`: `semi: true`, `singleQuote: false`, `tabWidth: 2`, `printWidth: 100`, `trailingComma: "es5"`.

Prettier runs on all `.ts` / `.tsx` / `.css` / `.json` files. Do not fight it — if Prettier reformats something, accept it.

---

## CSS Architecture

Single file: `web/styles.css`. No Tailwind, no CSS modules, no styled-components. This is intentional — the file is small enough to read in full and mobile-first dark-mode CSS is more maintainable without abstractions.

### Design tokens (`：root`)

```css
--bg, --bg-1, --bg-2, --bg-3       /* dark backgrounds, lightest = --bg-3 */
--border, --border-strong           /* dividers */
--text, --text-dim                  /* foreground */
--accent, --accent-soft             /* orange — primary interactive colour */
--danger, --danger-soft             /* red */
--success, --success-soft           /* green */
--warning                           /* yellow, rarely used */
--radius-sm, --radius-md, --radius-lg
--safe-top/bottom/left/right        /* env(safe-area-inset-*) */
```

### Layout classes

- `.app-shell` — full-viewport flex column
- `.page` — flex column child of app-shell
- `.page-body` — scrollable content area
- `.topbar` — sticky header with leading/title/trailing slots
- `.tab-pane` — flex column content area within `SessionPage`
- `.rows` / `.row` — list layout for folder browser, sessions, history

### Adding new styles

- Add to the relevant section in `styles.css`, grouped by feature.
- Use existing tokens — never hardcode colours.
- Mobile-first: write the default style for mobile, use `@media (min-width: 768px)` for desktop overrides.
- The files panel (`tab-pane-files`, `files-*`, `tree-*`) uses VSCode-style dark palette (`#1e1e1e`, `#252526`) instead of the global tokens — intentional.

---

## TypeScript Conventions

### Strict settings that matter

- **`noUncheckedIndexedAccess`** — array/map indexing returns `T | undefined`. Always null-check: `arr[0]!` (when you know it exists) or `arr[0] ?? fallback`.
- **`verbatimModuleSyntax`** — use `import type` for type-only imports.
- **`allowImportingTsExtensions`** — import `.ts` / `.tsx` files with their real extension. Do not omit the extension or use `.js`.

### Patterns

**API fetches in components:** always use `useAsync`:

```tsx
const { data, error, loading, reload } = useAsync(
  (signal) => fetchSomething(param, signal),
  [param]
);
```

**WS messages:** subscribe in `useEffect`, always return the unsubscribe function:

```tsx
useEffect(() => {
  return ws.onMessage((msg) => {
    if (msg.type === 'output' && msg.sessionId === sessionId) { ... }
  });
}, [ws, sessionId]);
```

**Icons:** import only from `web/src/components/icons.ts`. If you need a new Lucide icon, add it there first.

**Empty states:** use `<EmptyState icon={X} title="..." description="..." action={...} tone="error" />`. Never roll a custom empty state.

**Loading states:** use `<LoadingState label="..." />`. Never add ad-hoc spinners.

**No comments explaining what code does.** Code should be self-documenting. Only comment the _why_ when it's non-obvious (a constraint, a workaround, a subtle invariant).

---

## Key Design Decisions

**Why no framework for the server?**  
The HTTP surface is small (6 GET endpoints + WS upgrade). Adding Express or Fastify adds ~1 MB to the installed footprint for zero benefit.

**Why URL-first state?**  
The headline use case is cross-device handoff. A phone must be able to open any URL the laptop has open and land in the correct view. This rules out any ephemeral state that lives only in memory or `sessionStorage`.

**Why a ring buffer instead of full session replay?**  
Full replay would be unbounded memory per session. 64 KB is enough to reconstruct the visible terminal screen state for xterm.js with reasonable scrollback.

**Why Monaco via AMD loader instead of the npm package?**  
The Monaco npm package requires bundler-specific configuration and produces very large chunks. The AMD approach (copying `node_modules/monaco-editor/min/vs/` to `dist/web/assets/vs/`) is the officially supported pattern and produces the smallest runtime footprint. It lazy-loads on the first Files tab open.

**Why hand-rolled CSS?**  
The total CSS is ~1300 lines. Tailwind's overhead (PostCSS, JIT, purge config) is unjustified at this scale. Dark theme with a small token set is straightforward to maintain directly.

---

## Known Constraints and Gotchas

- **`noUncheckedIndexedAccess` bites CLI arg parsing.** Any `argv[i]` returns `string | undefined`. Use the `next(flagName)` helper in `cli.ts` as the pattern.
- **Monaco and `dist/web/`.** Vite's `emptyOutDir: false` is set deliberately — the monaco `min/vs/` tree is copied separately in `src/build.ts` and must not be deleted by Vite on rebuild.
- **`claude --resume <id>` and null originalFile.** Older Claude CLI versions (< 2.1.138) crash when resuming a conversation that included a "create new file" Edit operation. Past-conversation list items now use `--continue` to avoid this. The CLI was updated to 2.1.138 to fix the root cause.
- **Session list is in-memory.** Server restart clears all sessions. This is by design for MVP — there is no persistence layer.
- **Token in `sessionStorage`.** The one-shot token from the QR URL is stored in `sessionStorage` after the first load. It is NOT in `localStorage` — it clears when the browser tab is closed. This is intentional (security: a shared device doesn't permanently store the token).
- **SPA fallback catches everything.** Any path not matched by a REST endpoint or static file returns `index.html`. This means 404s from mistyped API paths will silently return HTML. Keep API paths under `/api/` and check `url.pathname` carefully when adding new routes.

---

## What Is Out of Scope (for now)

Do not add these without explicit discussion:

- **TLS / HTTPS.** Use Tailscale or SSH tunnel for over-WAN access.
- **Multi-user / auth beyond token.** The token is intentionally a single shared secret.
- **Session persistence across server restarts.** In-memory is fine for the use case.
- **A custom permission UI.** Claude Code's TUI permission prompts are answered via the terminal — that's the point. The 1/2/3 keybar buttons exist precisely for this.
- **Abstracting the CSS into a component library or Tailwind.** The current approach is intentional.
