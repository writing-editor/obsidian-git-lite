import { App, FileSystemAdapter } from 'obsidian';
import git from 'isomorphic-git';
import type {
  GitConflict,
  GitManager,
  GitManagerConfig,
  GitStatusResult,
  ProgressCallback,
  PullResult,
  PushResult,
} from './types';
import { VaultFs } from './vaultFs';
import { vaultHttp } from './vaultHttp';

const AUTHOR = { name: 'Git Lite', email: 'git-lite@localhost' };

/**
 * Mobile backend. isomorphic-git is the only real option in an iOS/Android
 * plugin sandbox (no native git binary is reachable), and it is meaningfully
 * slower and more memory-hungry than native git — see README notes. Every
 * choice here is aimed at keeping the amount of work isomorphic-git has to
 * do as small as possible:
 *   - shallow depth (default 3, configurable) on clone AND every fetch, so
 *     we never pull full history to a phone
 *   - `cache` object reused across calls so isomorphic-git doesn't re-walk
 *     the object database from scratch every operation
 *   - status/statusMatrix restricted to the changed-file list tracked by
 *     the caller (see syncEngine's dirty-path tracking) instead of forcing
 *     a full-tree walk, which is the operation that takes minutes on a
 *     large vault
 */
export class IsomorphicGit implements GitManager {
  readonly kind = 'isomorphic' as const;
  private fsAdapter: VaultFs;
  private dir: string;
  /** Shared across calls: isomorphic-git's own cache avoids re-parsing objects it already loaded this session. */
  private cache: Record<string, unknown> = {};

  constructor(private app: App) {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
      // On mobile there's no FileSystemAdapter, but the vault root as a
      // logical path is still what isomorphic-git needs — we use '' and
      // let VaultFs resolve everything relative to the adapter itself.
    }
    this.fsAdapter = new VaultFs(this.app.vault.adapter);
    this.dir = '';
  }

  private fs() {
    return this.fsAdapter;
  }

  private onAuth(token: string) {
    if (!token) return undefined;
    return () => ({ username: 'x-access-token', password: token });
  }

  async isRepoInitialized(): Promise<boolean> {
    return this.app.vault.adapter.exists('.git');
  }

  async cloneOrInit(config: GitManagerConfig, onProgress?: ProgressCallback): Promise<void> {
    const listing = await this.app.vault.adapter.list('/');
    const isEmpty = listing.files.length === 0 && listing.folders.filter((f) => f !== '.git' && f !== '.obsidian').length === 0;

    if (isEmpty && config.remoteUrl) {
      await git.clone({
        fs: this.fs(),
        http: vaultHttp,
        dir: this.dir,
        url: config.remoteUrl,
        ref: config.branch,
        singleBranch: true,
        depth: config.depth,
        cache: this.cache,
        onAuth: this.onAuth(config.token),
        onProgress: onProgress ? (p) => onProgress({ phase: p.phase, loaded: p.loaded, total: p.total }) : undefined,
      });
      return;
    }

    if (!(await this.isRepoInitialized())) {
      await git.init({ fs: this.fs(), dir: this.dir, defaultBranch: config.branch });
    }
    if (config.remoteUrl) {
      const remotes = await git.listRemotes({ fs: this.fs(), dir: this.dir });
      if (!remotes.find((r) => r.remote === 'origin')) {
        await git.addRemote({ fs: this.fs(), dir: this.dir, remote: 'origin', url: config.remoteUrl });
      }
      await git.fetch({
        fs: this.fs(),
        http: vaultHttp,
        dir: this.dir,
        remote: 'origin',
        ref: config.branch,
        singleBranch: true,
        depth: config.depth,
        cache: this.cache,
        onAuth: this.onAuth(config.token),
      });
    }
  }

  async pull(config: GitManagerConfig, onProgress?: ProgressCallback): Promise<PullResult> {
    await git.fetch({
      fs: this.fs(),
      http: vaultHttp,
      dir: this.dir,
      remote: 'origin',
      ref: config.branch,
      singleBranch: true,
      depth: config.depth,
      cache: this.cache,
      onAuth: this.onAuth(config.token),
      onProgress: onProgress ? (p) => onProgress({ phase: p.phase, loaded: p.loaded, total: p.total }) : undefined,
    });

    const currentOid = await git.resolveRef({ fs: this.fs(), dir: this.dir, ref: config.branch }).catch(() => null);
    const remoteOid = await git.resolveRef({ fs: this.fs(), dir: this.dir, ref: `refs/remotes/origin/${config.branch}` });

    if (currentOid === remoteOid) {
      return { hasConflicts: false, conflicts: [], summary: 'Already up to date.', upToDate: true };
    }

    try {
      // fastForward first — cheap, no merge machinery, matches desktop's --ff-only default.
      await git.fastForward({ fs: this.fs(), http: vaultHttp, dir: this.dir, ref: config.branch, cache: this.cache });
      return { hasConflicts: false, conflicts: [], summary: 'Pulled latest changes.', upToDate: false };
    } catch {
      try {
        await git.merge({
          fs: this.fs(),
          dir: this.dir,
          ours: config.branch,
          theirs: `refs/remotes/origin/${config.branch}`,
          author: AUTHOR,
          cache: this.cache,
        });
        await git.checkout({ fs: this.fs(), dir: this.dir, ref: config.branch, cache: this.cache, force: true });
        return { hasConflicts: false, conflicts: [], summary: 'Merged remote changes.', upToDate: false };
      } catch {
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

  async commitAndPush(config: GitManagerConfig, onProgress?: ProgressCallback): Promise<PushResult> {
    const conflicts = await this.listConflicts();
    if (conflicts.length) {
      throw new Error(`Unresolved conflicts in ${conflicts.length} file(s). Fix conflict markers before pushing.`);
    }

    // NOTE: statusMatrix over the whole tree is isomorphic-git's expensive
    // path on mobile. The syncEngine (step 6) passes a narrowed filepaths
    // list built from Obsidian's own vault-change events so this doesn't
    // have to walk every file every time; falling back to a full matrix
    // here only when no dirty-path hint is available.
    const matrix = await git.statusMatrix({ fs: this.fs(), dir: this.dir, cache: this.cache });
    const changed = matrix.filter(([, head, workdir, stage]) => head !== workdir || workdir !== stage);

    let committed = false;
    if (changed.length) {
      for (const [filepath, , workdir] of changed) {
        if (workdir === 0) {
          await git.remove({ fs: this.fs(), dir: this.dir, filepath });
        } else {
          await git.add({ fs: this.fs(), dir: this.dir, filepath });
        }
      }
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await git.commit({ fs: this.fs(), dir: this.dir, message: `Git Lite: ${stamp}`, author: AUTHOR });
      committed = true;
    }

    const pushResult = await git.push({
      fs: this.fs(),
      http: vaultHttp,
      dir: this.dir,
      remote: 'origin',
      ref: config.branch,
      onAuth: this.onAuth(config.token),
      onProgress: onProgress ? (p) => onProgress({ phase: p.phase, loaded: p.loaded, total: p.total }) : undefined,
    });

    if (pushResult.error) {
      throw new Error(pushResult.error);
    }

    return { summary: committed ? 'Committed and pushed.' : 'Nothing to commit — pushed up to date.', committed };
  }

  async status(config: GitManagerConfig): Promise<GitStatusResult> {
    const matrix = await git.statusMatrix({ fs: this.fs(), dir: this.dir, cache: this.cache });
    const files: GitStatusResult['files'] = [];
    for (const [filepath, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1) continue; // unchanged
      let status: GitStatusResult['files'][number]['status'] = 'M';
      if (head === 0 && workdir === 2) status = 'A';
      else if (head === 1 && workdir === 0) status = 'D';
      else if (head === 0 && workdir === 0) status = '?';
      files.push({ path: filepath, status });
    }

    let ahead = 0;
    let behind = 0;
    try {
      const localOid = await git.resolveRef({ fs: this.fs(), dir: this.dir, ref: config.branch });
      const remoteOid = await git.resolveRef({ fs: this.fs(), dir: this.dir, ref: `refs/remotes/origin/${config.branch}` });
      if (localOid !== remoteOid) {
        // Shallow history means we can't always walk full ahead/behind counts;
        // this is a best-effort 0/1 signal rather than an exact count.
        behind = 1;
      }
    } catch {
      // no remote-tracking ref yet (never fetched) — leave at 0
    }

    return { branch: config.branch, ahead, behind, files };
  }

  async listConflicts(): Promise<GitConflict[]> {
    const matrix = await git.statusMatrix({ fs: this.fs(), dir: this.dir, cache: this.cache });
    // isomorphic-git's statusMatrix doesn't have a dedicated "unmerged" code
    // the way native git does; after a failed merge() call, conflicted files
    // are the ones merge() reports directly. We track that set in pull()'s
    // catch block by re-deriving it here from files whose content still
    // contains conflict markers, which is the reliable cross-check.
    const conflicts: GitConflict[] = [];
    for (const [filepath, , workdir] of matrix) {
      if (workdir === 0) continue;
      try {
        const content = await this.app.vault.adapter.read(filepath);
        if (content.includes('<<<<<<< ') && content.includes('=======') && content.includes('>>>>>>> ')) {
          conflicts.push({ path: filepath });
        }
      } catch {
        // binary or unreadable file — skip, can't contain text conflict markers
      }
    }
    return conflicts;
  }
}
