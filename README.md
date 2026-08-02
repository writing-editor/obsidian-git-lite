# Git Lite

Git sync for an Obsidian vault: pull, commit & push, status — on **desktop
and mobile**.

- **Desktop**: shells out to your real `git` binary (`SimpleGit`).
- **Mobile (iOS/Android)**: uses [isomorphic-git](https://isomorphic-git.org/),
  the only viable option inside a mobile plugin sandbox — there's no way to
  reach a native `git` binary from an Obsidian mobile plugin. Every clone/fetch
  is shallow (`depth: 3` by default) to keep this fast and light on memory;
  see `src/gitManager/isomorphicGit.ts` for the reasoning.

Both platforms implement the same `GitManager` interface
(`src/gitManager/types.ts`), so commands, settings, and conflict handling are
shared code.

## First run

If the vault is empty, Git Lite clones your remote into it. If the vault
already has files, it initializes a repo in place and fetches — you don't
need to `git init`/`git clone` by hand first.

## Commands

- **Git: Pull** — fetch + fast-forward; falls back to a real merge if history
  has diverged, and reports which files have conflict markers instead of
  failing silently.
- **Git: Commit & push** — stages everything, commits with a timestamp if
  there are changes, then pushes. Refuses to push while any file has
  unresolved conflict markers.
- **Git: Status** — branch, ahead/behind, changed-file count as a Notice.

## Settings

- Remote URL, branch
- **Clone/fetch depth** (default 3) — shallow on purpose; raise it only if
  you need to browse older history.
- Personal access token — used as a Basic-auth header on pull/push/fetch
  only, scoped per-request; never written to `.git/config`. Encrypted at
  rest via the OS keychain when available (desktop only), otherwise stored
  in plaintext in this plugin's `data.json`.
- **Auto-sync** — commit & push automatically after edits settle (debounced),
  instead of only on manual command.

## What's intentionally out of scope

- SSH remotes (isomorphic-git has no SSH support — use an HTTPS remote +
  PAT, which is also what the token setting is built around).
- Full history browsing / arbitrary-depth log on mobile.
- Submodules, LFS, GPG signing on mobile.

## `.gitignore`

On first load, Git Lite writes a starter `.gitignore` (only if none exists)
excluding `.obsidian/workspace*.json`, `.obsidian/cache`, per-plugin
`data.json`, and `.trash/` — local UI state that shouldn't sync between
devices. Edit it freely afterward; Git Lite never overwrites an existing one.

## Building

```
npm install
npm run build
```

Requires `git` on desktop's `PATH`. No native dependency needed on mobile —
`isomorphic-git` is pure JS and gets bundled into `main.js`.
