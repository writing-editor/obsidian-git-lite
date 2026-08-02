import { App, FileSystemAdapter } from 'obsidian';
import type {
  GitConflict,
  GitManager,
  GitManagerConfig,
  GitStatusResult,
  PullResult,
  PushResult,
} from './types';

/**
 * Desktop backend. Shells out to the native `git` binary via child_process.
 * Kept as close as possible to the original gitSync.ts logic — that part of
 * the old plugin was sound, this mostly just fits it into the GitManager
 * interface and adds real conflict handling instead of letting `pull` throw.
 */
export class SimpleGit implements GitManager {
  readonly kind = 'simple' as const;

  constructor(private app: App) {}

  private cwd(): string {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
      throw new Error('Git sync needs direct filesystem access, only available in the desktop app.');
    }
    return this.app.vault.adapter.getBasePath();
  }

  private run(args: string[], cwd = this.cwd()): Promise<{ stdout: string; stderr: string }> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFile } = require('child_process') as typeof import('child_process');
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd, maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.toString().trim() || err.message));
        else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      });
    });
  }

  private authArgs(token: string): string[] {
    if (!token) return [];
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    // Scoped to this single invocation via -c, never written to .git/config.
    return ['-c', `http.extraheader=Authorization: Basic ${basic}`];
  }

  async isRepoInitialized(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    return fs.existsSync(path.join(this.cwd(), '.git'));
  }

  private async ensureRemote(config: GitManagerConfig): Promise<void> {
    if (!config.remoteUrl) return;
    try {
      await this.run(['remote', 'set-url', 'origin', config.remoteUrl]);
    } catch {
      await this.run(['remote', 'add', 'origin', config.remoteUrl]);
    }
  }

  async cloneOrInit(config: GitManagerConfig): Promise<void> {
    const cwd = this.cwd();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    const isEmpty = fs.readdirSync(cwd).length === 0;

    if (isEmpty && config.remoteUrl) {
      // Clean vault: a real `git clone --depth N` is both simpler and cheaper
      // than init+fetch+reset.
      await this.run([...this.authArgs(config.token), 'clone', '--depth', String(config.depth), '--branch', config.branch, config.remoteUrl, '.'], cwd);
      return;
    }

    if (!(await this.isRepoInitialized())) {
      await this.run(['init'], cwd);
      if (config.branch) await this.run(['checkout', '-B', config.branch], cwd);
    }
    await this.ensureRemote(config);
    if (config.remoteUrl) {
      await this.run([...this.authArgs(config.token), 'fetch', '--depth', String(config.depth), 'origin', config.branch], cwd);
    }
  }

  async pull(config: GitManagerConfig): Promise<PullResult> {
    await this.ensureRemote(config);
    try {
      const { stdout } = await this.run([
        ...this.authArgs(config.token),
        'pull',
        '--ff-only',
        '--depth',
        String(config.depth),
        'origin',
        config.branch,
      ]);
      const upToDate = /already up to date/i.test(stdout);
      return { hasConflicts: false, conflicts: [], summary: upToDate ? 'Already up to date.' : stdout.trim().slice(0, 200), upToDate };
    } catch (err) {
      // ff-only failed: history diverged. Try an actual merge so the user
      // gets a mergeable result (with conflict markers) instead of a dead end.
      const message = err instanceof Error ? err.message : String(err);
      if (!/non-fast-forward|diverged|fatal: Not possible to fast-forward/i.test(message)) {
        throw err;
      }
      await this.run([...this.authArgs(config.token), 'fetch', '--depth', String(config.depth), 'origin', config.branch]);
      try {
        await this.run(['merge', `origin/${config.branch}`, '-m', 'Git Lite: merge remote changes']);
        return { hasConflicts: false, conflicts: [], summary: 'Merged remote changes.', upToDate: false };
      } catch (mergeErr) {
        const conflicts = await this.listConflicts();
        return {
          hasConflicts: true,
          conflicts,
          summary: `Merge conflict in ${conflicts.length} file${conflicts.length === 1 ? '' : 's'}. Resolve manually, then Commit & push.`,
          upToDate: false,
        };
      }
    }
  }

  async commitAndPush(config: GitManagerConfig): Promise<PushResult> {
    await this.ensureRemote(config);

    const conflicts = await this.listConflicts();
    if (conflicts.length) {
      throw new Error(`Unresolved conflicts in ${conflicts.length} file(s). Fix conflict markers before pushing.`);
    }

    const { stdout: statusOut } = await this.run(['status', '--porcelain']);
    let committed = false;
    if (statusOut.trim()) {
      await this.run(['add', '-A']);
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await this.run(['commit', '-m', `Git Lite: ${stamp}`]);
      committed = true;
    }

    const { stdout } = await this.run([...this.authArgs(config.token), 'push', 'origin', config.branch]);
    return { summary: (stdout.trim() || 'Everything up to date.').slice(0, 200), committed };
  }

  async status(config: GitManagerConfig): Promise<GitStatusResult> {
    const { stdout } = await this.run(['status', '--porcelain', '-b']);
    const lines = stdout.trim().split('\n');
    const branchLine = lines[0] ?? '';
    const aheadMatch = branchLine.match(/ahead (\d+)/);
    const behindMatch = branchLine.match(/behind (\d+)/);
    const files = lines.slice(1).map((line) => {
      const code = line.slice(0, 2).trim();
      const path = line.slice(3);
      const status: GitStatusResult['files'][number]['status'] =
        code.includes('U') || code === 'AA' || code === 'DD' ? 'U' : code === '??' ? '?' : code.includes('D') ? 'D' : code.includes('A') ? 'A' : 'M';
      return { path, status };
    });
    return {
      branch: branchLine.replace(/^## /, '').split('...')[0] || config.branch,
      ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
      behind: behindMatch ? parseInt(behindMatch[1], 10) : 0,
      files,
    };
  }

  async listConflicts(): Promise<GitConflict[]> {
    const { stdout } = await this.run(['diff', '--name-only', '--diff-filter=U']);
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((path) => ({ path }));
  }
}
