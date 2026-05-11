<img src="web/public/favicon.svg" alt="Remote Vibe Coder" width="96" height="96" />

# Remote Vibe Coder

Orchestrate Claude Code from anywhere

## What is RVC?

A tiny local web server that wraps the real `claude` CLI in a PTY and renders it in your browser. Complete with a folder picker, conversation history, a Monaco-powered file viewer with diff and commit functionality, and voice transcription.

Start a session on your laptop, and finish on your phone. Start new sessions and commit changes from anywhere. Vibe out from any device with an internet connection and a browser.

## Quick start

Requires Node 25+ and the `claude` CLI on your PATH.

```bash
npx rvc --root ~/Websites
```

> `rvc` is shorthand for `remote-vibe-coder` — both commands work.

Open the printed URL. By default it binds to `127.0.0.1` only.

## Connect from your phone

```bash
npx rvc --root ~/Websites --host 0.0.0.0
```

A QR code is printed on startup. Scan it with your phone — the URL includes a one-shot token that's stored in `sessionStorage` after the first load.

## Features

- **PTY-backed terminal**: spawns the real `claude` CLI, so every TUI feature works — slash commands, autocomplete, permission prompts, mid-task cancellation.
- **Multi-viewer sessions**: the PTY is independent of any browser. Multiple devices can attach to the same `sessionId` and watch in real time. New attachers get a 64 KB ring-buffer replay so the screen looks correct on first connect.
- **Conversation history**: lists past sessions per folder by reading `~/.claude/projects/<encoded-cwd>/*.jsonl`. Click any to resume via `claude --resume <id>`.
- **VSCode-style files panel**: file tree + Monaco editor (the real one VSCode uses) + git diff vs HEAD.
- **Voice input**: a microphone button on the keybar that transcribes using the browser's native Web Speech API.
- **URL-driven state**: every view (folder, picker, session, file path, diff toggle) is encoded in the URL. Browser reload restores you to the exact place.
- **Mobile-first**: 1/2/3 (yes/no/other) keys are first-class buttons on the keybar; arrow keys, Esc, Tab, Ctrl+C, and a soft-keyboard summon are one tap away.

## CLI

```
remote-vibe-coder [options]   # or: rvc [options]

  -p, --port <n>         Port to listen on (default: 4310)
  -H, --host <addr>      Bind address (default: 127.0.0.1; use 0.0.0.0 for LAN)
  -r, --root <path>      Folder you can browse (default: ~/Websites)
  -t, --token <str>      Require ?token=… (auto-generated on non-loopback host)
      --no-token         Skip token (insecure on LAN)
  -c, --command <bin>    Command to run in each session (default: claude)
  -h, --help             Show this help
```

## Trust model

- The token is shown only on the local TTY where the server starts.
- Anyone with the token can run `claude` against the user's account, including all of its tool permissions. Treat the token like an SSH key.
- For over-WAN access, prefer a Tailscale or SSH tunnel rather than exposing the port.

## Development

```bash
git clone <repo>
cd remote-vibe-coder
npm install
npm run dev   # builds web bundle, then runs the server with tsx watch
```

`npm run build` produces `dist/` (server bundle + bundled web assets + monaco assets).

## License

MIT
