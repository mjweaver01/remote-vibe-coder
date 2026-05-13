<img src="web/public/favicon.svg" alt="Remote Vibe Coder" width="96" height="96" />

# Remote Vibe Coder

[![CI](https://github.com/mjweaver01/remote-vibe-coder/actions/workflows/ci.yml/badge.svg)](https://github.com/mjweaver01/remote-vibe-coder/actions/workflows/ci.yml)

Orchestrate Claude Code from anywhere.

## What is RVC?

A tiny local web server that wraps the `claude` CLI in a PTY and renders it in your browser. Vibe code, review diffs, commit, and ship remotely.

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

Over the internet, via an anonymous HTTPS tunnel (powered by [ducky.wtf](https://www.ducky.wtf)):

```bash
npx rvc --root ~/Websites --https
# --ducky is an alias for --https
```

A QR code is printed on startup. Scan it — the URL carries a one-shot token stored in `sessionStorage` after first load.

No signup, no auth token: ducky issues a fresh anonymous subdomain each run. [`@ducky.wtf/cli`](https://www.npmjs.com/package/@ducky.wtf/cli) ships as a regular dependency, so there's nothing extra to install.

## Features

- **PTY-backed terminal**: the real `claude` CLI — slash commands, autocomplete, permission prompts, cancellation.
- **Multi-viewer sessions**: PTY is independent of the browser. Multiple devices attach to the same `sessionId`; new attachers get a 64 KB ring-buffer replay.
- **Conversation history + continue**: pick up the last conversation in a folder, or resume any past session from `~/.claude/projects/`.
- **Files panel**: file tree + Monaco editor + git diff vs HEAD.
- **Git commits from the browser**: stage/unstage and commit without leaving the page.
- **Voice input**: mic button on the keybar, native Web Speech API.
- **Built-in HTTPS tunnel**: `--https` (alias `--ducky`) gives you a public HTTPS URL with a one-shot token — no signup, no reverse proxy, no port forwarding. Anonymous tunnels via [ducky.wtf](https://ducky.wtf).
- **Folder favorites + filter**: star folders and filter the browser list.
- **URL-driven state**: every view is in the URL — reload restores it exactly.
- **Mobile-first keybar**: 1/2/3 (yes/no/other), arrows, Esc, Tab, Ctrl+C, soft-keyboard summon.

## CLI

```
rvc [options]   # alias of remote-vibe-coder

  -p, --port <n>             Port to listen on (default: 4310)
  -H, --host <addr>          Bind address (default: 127.0.0.1; 0.0.0.0 for LAN)
  -r, --root <path>          Folder you can browse (default: ~/Websites)
  -t, --token <str>          Require ?token=… (auto-generated with --https/--ducky or non-loopback host)
      --no-token             Skip token (insecure)
  -c, --command <bin>        Command to run in each session (default: claude)
      --idle-timeout <m>     Kill sessions idle for more than <m> minutes
      --https, --ducky       Expose via a public HTTPS tunnel (ducky.wtf, anonymous)
  -h, --help                 Show this help
```

## Trust model

The token is shown only on the local TTY where the server starts. Anyone with it can run `claude` as you — treat it like an SSH key. For WAN access, use `--https` (anonymous ducky.wtf tunnel), Tailscale, or an SSH tunnel.

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
