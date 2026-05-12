---
description: Cut a new GitHub release — bump version, commit, tag, push, write notes in the v0.1.0 style.
---

# Cut a release

Follow these steps exactly. Confirm the proposed version with the user before pushing.

## 1. Check the current state

Run in parallel:

- `git status --short` — must be clean before starting
- `gh release list --limit 5` — find the latest tag
- `gh release view <latest-tag>` — see prior notes for tone/style
- `git log --oneline <latest-tag>..HEAD` — what changed
- `git diff <latest-tag>..HEAD --stat | tail -30` — rough scope

## 2. Decide the version bump

Use semver against the changes since the last tag:

- **patch** (`0.x.Y → 0.x.(Y+1)`): bug fixes, internal refactors, perf, tests, docs.
- **minor** (`0.X.y → 0.(X+1).0`): user-visible features, new flags, new endpoints, new UI surfaces.
- **major** (`X.y.z → (X+1).0.0`): breaking changes to CLI flags, REST/WS protocol, or on-disk layouts. Pre-1.0 we still bump minor for these and call it out loudly in notes.

State your proposed version and one-sentence justification to the user. Wait for confirmation before continuing.

## 3. Bump the version

Edit **both**:

- `package.json` — top-level `"version"` field.
- `package-lock.json` — both `"version"` at line ~3 and `packages[""].version`. Use a single `Edit` on the literal block; never run `npm install` just to refresh the lockfile (that pulls in unrelated dep updates).

## 4. Commit, tag, push

```bash
git add package.json package-lock.json
git commit -m "Release v<X.Y.Z>"
git tag v<X.Y.Z>
git push origin <main-branch>
git push origin v<X.Y.Z>
```

No `Co-Authored-By` trailer on the release commit — keep it terse.

## 5. Write release notes (the v0.1.0 / v0.2.0 style)

Read `gh release view <prior-tag>` first and **match its tone**. The format is:

```markdown
<One-sentence framing line — what this release is "about", e.g. "Quality-of-life release focused on the cross-device workflow." or "First public release.">

- **<Headline feature in bold>** — one or two sentences. Lead with the user-visible thing, not the implementation.
- **<Next feature>** — …
- (4–8 bullets total. Group related fixes under one bullet rather than enumerating every commit.)

## Install

`​``
npx remote-vibe-coder --root ~/Websites
`​``

Requires Node 25+ and the `claude` CLI on your PATH.
```

Rules:

- **Bold the lead noun** of each bullet (the feature name), then an em-dash, then prose. No nested bullets, no headings inside the list.
- Frame bullets in terms of what the user can now do, not the patch they got. "Web Push notifications when Claude is waiting for input" beats "Added VAPID handshake to server".
- Bug fixes shipped alongside features go into the relevant feature's bullet. Pure-bugfix releases get their own bullets ("Fixed <thing> that <symptom>").
- Keep the **Install** block byte-for-byte identical across releases.
- Don't reference commit hashes, PR numbers, or contributor handles unless an external person contributed.

## 6. Publish

```bash
gh release create v<X.Y.Z> --title v<X.Y.Z> --notes "$(cat <<'EOF'
<notes body from step 5>
EOF
)"
```

Always use a heredoc — interpolation breaks code fences. The CLI prints the release URL; surface it to the user as the final message.

## 7. After-release

- If `prepublishOnly` is wired (it is — runs `npm run build`), the npm publish is gated by a build. Do **not** run `npm publish` from the agent — wait for the user to ask.
- If anything fails partway through (tag pushed, release create failed), do **not** delete the tag. Re-run `gh release create` only — the tag is the source of truth.
