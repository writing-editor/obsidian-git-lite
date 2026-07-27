# Git Lite

Minimal git commands for an Obsidian vault: pull, commit & push, status.
Desktop only — needs direct filesystem + `git` binary access.

Assumes your vault root is already a git repository (`git init`/`git clone`
it yourself first).

## Commands

- **Git: Pull** — `git pull --ff-only origin <branch>`
- **Git: Commit & push** — stages everything, commits with a timestamp if
  there are changes, then pushes
- **Git: Status** — porcelain status summary as a Notice

## Settings

- Remote URL
- Branch
- Personal access token (used as a Basic-auth header on pull/push only —
  never written to `.git/config`; encrypted at rest via the OS keychain
  when available, otherwise stored in plaintext in this plugin's
  `data.json`)
