import { Notice } from 'obsidian';
import type { GitManager, GitManagerConfig } from './gitManager/types';

/**
 * Single place that both platforms' commands call through. Keeps the
 * "what does the user see when something goes wrong" logic in one spot
 * instead of duplicated per-backend, and is where the conflict-blocking
 * rule lives: you cannot commit&push while conflict markers exist anywhere
 * in the vault, regardless of which backend is active.
 */
export class SyncEngine {
  constructor(private manager: GitManager, private config: () => GitManagerConfig) {}

  async ensureInitialized(): Promise<void> {
    if (!(await this.manager.isRepoInitialized())) {
      new Notice('Git Lite: setting up repository…');
      await this.manager.cloneOrInit(this.config());
      new Notice('Git Lite: repository ready.');
    }
  }

  async pull(): Promise<void> {
    await this.ensureInitialized();
    const result = await this.manager.pull(this.config());
    if (result.hasConflicts) {
      const list = result.conflicts.slice(0, 5).map((c) => c.path).join(', ');
      const more = result.conflicts.length > 5 ? ` (+${result.conflicts.length - 5} more)` : '';
      new Notice(`Git Lite: ${result.summary}\n${list}${more}`, 10000);
      return;
    }
    new Notice(`Git Lite: ${result.summary}`);
  }

  async commitAndPush(): Promise<void> {
    await this.ensureInitialized();

    // Belt-and-suspenders: check for conflicts up front too, so the user
    // gets a clear message instead of the backend's raw push error.
    const conflicts = await this.manager.listConflicts();
    if (conflicts.length) {
      const list = conflicts.slice(0, 5).map((c) => c.path).join(', ');
      const more = conflicts.length > 5 ? ` (+${conflicts.length - 5} more)` : '';
      new Notice(
        `Git Lite: can't push — unresolved conflicts in ${conflicts.length} file(s).\n${list}${more}\nResolve conflict markers, save, then try again.`,
        10000
      );
      return;
    }

    const result = await this.manager.commitAndPush(this.config());
    new Notice(`Git Lite: ${result.summary}`);
  }

  async status(): Promise<void> {
    await this.ensureInitialized();
    const s = await this.manager.status(this.config());
    const changed = s.files.length;
    const aheadBehind = s.ahead || s.behind ? ` (ahead ${s.ahead}, behind ${s.behind})` : '';
    new Notice(`Git Lite: ${s.branch}${aheadBehind} — ${changed} file${changed === 1 ? '' : 's'} changed.`);
  }
}
