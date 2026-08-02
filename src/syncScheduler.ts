import { App, Notice, TAbstractFile } from 'obsidian';
import type { SyncEngine } from './syncEngine';

/**
 * Wraps SyncEngine with three things the raw engine deliberately doesn't do:
 *
 *  1. A lock, so a background auto-sync and a manually-triggered command
 *     can't run git operations concurrently (isomorphic-git especially has
 *     no index-locking of its own the way native git does with .git/index.lock,
 *     so two overlapping writes can corrupt the working tree).
 *  2. Retry with backoff for push/pull, aimed at flaky mobile networks —
 *     a dropped cellular connection mid-transfer shouldn't require the user
 *     to notice and retry by hand.
 *  3. A debounced auto-sync triggered by Obsidian's vault change events,
 *     batching many small edits into one commit instead of committing on
 *     every keystroke/save.
 */
export class SyncScheduler {
  private locked = false;
  private debounceTimer: number | null = null;
  private dirtyPaths = new Set<string>();

  constructor(
    private app: App,
    private engine: SyncEngine,
    private options: { debounceMs: number; maxRetries: number; retryBaseDelayMs: number; isAutoSyncEnabled: () => boolean }
  ) {}

  /**
   * Call once from onload() if the user has auto-sync enabled. Takes the
   * owning Plugin so listeners go through registerEvent() and get torn down
   * automatically on unload/reload instead of leaking.
   */
  registerAutoSync(plugin: import('obsidian').Plugin): void {
    const track = (file: TAbstractFile) => {
      this.dirtyPaths.add(file.path);
      this.scheduleDebouncedSync();
    };
    plugin.registerEvent(this.app.vault.on('modify', track));
    plugin.registerEvent(this.app.vault.on('create', track));
    plugin.registerEvent(this.app.vault.on('delete', track));
    plugin.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.dirtyPaths.add(file.path);
        this.dirtyPaths.add(oldPath);
        this.scheduleDebouncedSync();
      })
    );
  }

  /** Snapshot of paths touched since the last successful sync — feeds the mobile backend's narrowed status scan. */
  takeDirtySnapshot(): string[] {
    const paths = Array.from(this.dirtyPaths);
    this.dirtyPaths.clear();
    return paths;
  }

  private scheduleDebouncedSync(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      if (!this.options.isAutoSyncEnabled()) return; // toggled off since the edit — skip silently
      this.runLocked(() => this.engine.commitAndPush()).catch((err) =>
        new Notice(`Git Lite: auto-sync failed: ${err.message ?? err}`)
      );
    }, this.options.debounceMs);
  }

  /** Public entry points for commands — these go through the same lock as auto-sync. */
  async pull(): Promise<void> {
    await this.runLocked(() => this.withRetry(() => this.engine.pull()));
  }

  async commitAndPush(): Promise<void> {
    await this.runLocked(() => this.withRetry(() => this.engine.commitAndPush()));
  }

  async status(): Promise<void> {
    // Read-only — safe to skip the lock so a Status check never has to wait
    // behind a slow push.
    await this.engine.status();
  }

  private async runLocked<T>(fn: () => Promise<T>): Promise<T> {
    if (this.locked) {
      new Notice('Git Lite: a sync is already in progress — try again shortly.');
      throw new Error('sync already in progress');
    }
    this.locked = true;
    try {
      return await fn();
    } finally {
      this.locked = false;
    }
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!this.isRetryable(err) || attempt === this.options.maxRetries) break;
        const delay = this.options.retryBaseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => window.setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  private isRetryable(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    // Network-shaped failures only — never retry auth errors, conflicts, or
    // ff-only rejections, since retrying those just repeats the same failure.
    return /network|timeout|ECONNRESET|ETIMEDOUT|fetch failed|Failed to fetch|ENOTFOUND/i.test(message);
  }
}
