<img src="web/public/favicon.svg" alt="Remote Vibe Coder" width="96" height="96" />

# Remote Vibe Coder

[![CI](https://github.com/mjweaver01/remote-vibe-coder/actions/workflows/ci.yml/badge.svg)](https://github.com/mjweaver01/remote-vibe-coder/actions/workflows/ci.yml)

Orchestrate Claude Code from anywhere.

## What is RVC?

A tiny local web server that wraps the real `claude` CLI in a PTY and renders it in your browser. Folder picker, conversation history, Monaco-powered file viewer with diff + commit, and voice transcription.

Start a session on your laptop, finish on your phone. Vibe out from any device with a browser.

## Quick start

Requires Node 25+ and the `claude` CLI on your PATH.

```bash
npx rvc --root ~/Websites
```

> `rvc` is shorthand for `remote-vibe-coder` — both commands work.

Open the printed URL. Binds to `127.0.0.1` by default.

## Connect from your phone

On your LAN:

```bash
npx rvc --root ~/Websites --host 0.0.0.0
```

Over the internet, via an HTTPS ngrok tunnel:

```bash
npx rvc --root ~/Websites --ngrok
```

A QR code is printed on startup. Scan it — the URL carries a one-shot token stored in `sessionStorage` after first load.

`--ngrok` requires an authtoken (get one at https://dashboard.ngrok.com). Provide it via `--ngrok-authtoken <t>`, the `NGROK_AUTHTOKEN` env var, or `ngrok config add-authtoken <t>`. Use `--ngrok-domain <d>` to pin a reserved domain.

## Features

- **PTY-backed terminal**: the real `claude` CLI — slash commands, autocomplete, permission prompts, cancellation.
- **Multi-viewer sessions**: PTY is independent of the browser. Multiple devices attach to the same `sessionId`; new attachers get a 64 KB ring-buffer replay.
- **Conversation history + continue**: pick up the last conversation in a folder, or resume any past session from `~/.claude/projects/`.
- **Files panel**: file tree + Monaco editor + git diff vs HEAD.
- **Git commits from the browser**: stage/unstage and commit without leaving the page.
- **Voice input**: mic button on the keybar, native Web Speech API.
- **Folder favorites + filter**: star folders and filter the browser list.
- **URL-driven state**: every view is in the URL — reload restores it exactly.
- **Mobile-first keybar**: 1/2/3 (yes/no/other), arrows, Esc, Tab, Ctrl+C, soft-keyboard summon.

## CLI

```
rvc [options]   # alias of remote-vibe-coder

  -p, --port <n>             Port to listen on (default: 4310)
  -H, --host <addr>          Bind address (default: 127.0.0.1; 0.0.0.0 for LAN)
  -r, --root <path>          Folder you can browse (default: ~/Websites)
  -t, --token <str>          Require ?token=… (auto-generated with --ngrok or non-loopback host)
      --no-token             Skip token (insecure)
  -c, --command <bin>        Command to run in each session (default: claude)
      --idle-timeout <m>     Kill sessions idle for more than <m> minutes
      --ngrok                Expose via ngrok tunnel (HTTPS)
      --ngrok-authtoken <t>  ngrok authtoken (overrides NGROK_AUTHTOKEN env). Implies --ngrok.
      --ngrok-domain <d>     Reserved ngrok domain. Implies --ngrok.
  -h, --help                 Show this help
```

## Trust model

The token is shown only on the local TTY where the server starts. Anyone with it can run `claude` as you — treat it like an SSH key. For WAN access, use `--ngrok` (HTTPS tunnel), Tailscale, or an SSH tunnel.

## Development

```bash
git clone git@github.com:mjweaver01/remote-vibe-coder.git
cd remote-vibe-coder
npm install
npm run dev         # vite watch + tsx watch
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run build       # produces dist/ (server + web + monaco)
```

## License

MIT
