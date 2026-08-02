/**
 * Platform-agnostic contract that both the desktop (native git binary) and
 * mobile (isomorphic-git) backends implement. Nothing in main.ts or the
 * settings tab should know which backend it's talking to.
 */

export interface GitFileStatus {
  /** Path relative to vault root. */
  path: string;
  /** Single-letter porcelain-ish status: 'A' add, 'M' modify, 'D' delete, 'U' unmerged/conflict. */
  status: 'A' | 'M' | 'D' | 'U' | '?';
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

export interface GitConflict {
  path: string;
}

/** Result of a pull/merge attempt. */
export interface PullResult {
  /** True if the working tree now has files with unresolved conflict markers. */
  hasConflicts: boolean;
  conflicts: GitConflict[];
  /** Human-readable summary for a Notice. */
  summary: string;
  /** True if nothing changed (already up to date). */
  upToDate: boolean;
}

export interface PushResult {
  summary: string;
  /** True if a commit was created before pushing. */
  committed: boolean;
}

export interface CloneProgress {
  phase: string;
  loaded?: number;
  total?: number;
}

export type ProgressCallback = (p: CloneProgress) => void;

export interface GitManagerConfig {
  remoteUrl: string;
  branch: string;
  /** Shallow-history depth for clone/fetch. Kept small on purpose — see gitManager README notes. */
  depth: number;
  token: string;
}

/**
 * Common interface implemented by SimpleGit (desktop) and IsomorphicGit (mobile).
 * All methods operate on the vault root as the repo working directory.
 */
export interface GitManager {
  readonly kind: 'simple' | 'isomorphic';

  /** Returns true once a `.git` dir exists at the vault root. */
  isRepoInitialized(): Promise<boolean>;

  /** Clones the remote into the (empty) vault root, or inits + fetches if the vault already has files. */
  cloneOrInit(config: GitManagerConfig, onProgress?: ProgressCallback): Promise<void>;

  /** Fast-forward-only pull. If it can't fast-forward, attempts a merge and reports conflicts instead of throwing. */
  pull(config: GitManagerConfig, onProgress?: ProgressCallback): Promise<PullResult>;

  /** Stages all changes, commits if there's anything to commit, then pushes. */
  commitAndPush(config: GitManagerConfig, onProgress?: ProgressCallback): Promise<PushResult>;

  status(config: GitManagerConfig): Promise<GitStatusResult>;

  /** Paths (relative to vault root) that currently contain unresolved conflict markers. */
  listConflicts(): Promise<GitConflict[]>;
}
