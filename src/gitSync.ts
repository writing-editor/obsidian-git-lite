import { App, FileSystemAdapter, Notice, Platform } from 'obsidian';
import type { GitSettings } from './settings';

function run(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFile } = require('child_process') as typeof import('child_process');
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim() || err.message));
      else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

function vaultBasePath(app: App): string {
  if (!(app.vault.adapter instanceof FileSystemAdapter)) {
    throw new Error('Git sync needs direct filesystem access, only available in the desktop app.');
  }
  return app.vault.adapter.getBasePath();
}

function authHeaderArgs(token: string): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  // Scoped to this single invocation via -c, so it never touches .git/config.
  return ['-c', `http.extraheader=Authorization: Basic ${basic}`];
}

async function ensureRepo(cwd: string, git: GitSettings): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path') as typeof import('path');
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    await run(cwd, ['init']);
    if (git.branch) await run(cwd, ['checkout', '-B', git.branch]);
  }
  if (git.remoteUrl) {
    try {
      await run(cwd, ['remote', 'set-url', 'origin', git.remoteUrl]);
    } catch {
      await run(cwd, ['remote', 'add', 'origin', git.remoteUrl]);
    }
  }
}

function requireDesktop() {
  if (!Platform.isDesktopApp) throw new Error('Git sync is desktop-only (needs direct filesystem + git binary access).');
}

export async function gitPull(app: App, git: GitSettings, token: string): Promise<void> {
  requireDesktop();
  const cwd = vaultBasePath(app);
  await ensureRepo(cwd, git);
  const { stdout } = await run(cwd, [...authHeaderArgs(token), 'pull', '--ff-only', 'origin', git.branch]);
  new Notice(`Margin Notes: git pull done.\n${stdout.trim().slice(0, 200) || 'Already up to date.'}`);
}

export async function gitCommitAndPush(app: App, git: GitSettings, token: string): Promise<void> {
  requireDesktop();
  const cwd = vaultBasePath(app);
  await ensureRepo(cwd, git);

  const { stdout: statusOut } = await run(cwd, ['status', '--porcelain']);
  if (statusOut.trim()) {
    await run(cwd, ['add', '-A']);
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await run(cwd, ['commit', '-m', `Margin Notes: ${stamp}`]);
  }

  const { stdout } = await run(cwd, [...authHeaderArgs(token), 'push', 'origin', git.branch]);
  new Notice(`Margin Notes: pushed.\n${(stdout.trim() || 'Everything up to date.').slice(0, 200)}`);
}

export async function gitStatus(app: App, git: GitSettings): Promise<void> {
  requireDesktop();
  const cwd = vaultBasePath(app);
  await ensureRepo(cwd, git);
  const { stdout } = await run(cwd, ['status', '--porcelain', '-b']);
  const lines = stdout.trim().split('\n');
  const branchLine = lines[0] ?? '';
  const changed = lines.length - 1;
  new Notice(`Margin Notes: ${branchLine.replace(/^## /, '')} — ${changed} file${changed === 1 ? '' : 's'} changed.`);
}
