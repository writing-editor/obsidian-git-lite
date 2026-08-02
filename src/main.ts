import { Notice, Plugin, Platform } from 'obsidian';
import { DEFAULT_SETTINGS, GitLiteSettings, GitLiteSettingTab } from './settings';
import { decryptSecret } from './secureStorage';
import { SimpleGit } from './gitManager/simpleGit';
import { IsomorphicGit } from './gitManager/isomorphicGit';
import type { GitManager, GitManagerConfig } from './gitManager/types';
import { SyncEngine } from './syncEngine';
import { SyncScheduler } from './syncScheduler';
import { ensureGitignore } from './gitignore';

export default class GitLitePlugin extends Plugin {
  settings: GitLiteSettings = DEFAULT_SETTINGS;
  private manager!: GitManager;
  private engine!: SyncEngine;
  private scheduler!: SyncScheduler;
  private statusBarEl!: HTMLElement;
  private autoSyncRegistered = false;

  async onload() {
    await this.loadSettings();

    // Platform choice happens once, here — everything downstream just talks
    // to the GitManager interface and doesn't care which backend it got.
    this.manager = Platform.isDesktopApp ? new SimpleGit(this.app) : new IsomorphicGit(this.app);

    const config = (): GitManagerConfig => ({
      remoteUrl: this.settings.git.remoteUrl,
      branch: this.settings.git.branch,
      depth: this.settings.git.depth,
      token: decryptSecret(this.settings.secrets.gitToken),
    });

    this.engine = new SyncEngine(this.manager, config);
    this.scheduler = new SyncScheduler(this.app, this.engine, {
      debounceMs: this.settings.autoSync.debounceSeconds * 1000,
      maxRetries: 3,
      retryBaseDelayMs: 1500,
      isAutoSyncEnabled: () => this.settings.autoSync.enabled,
    });

    this.statusBarEl = this.addStatusBarItem();
    this.setStatusBarText(Platform.isDesktopApp ? 'Git Lite (desktop)' : 'Git Lite (mobile)');

    this.addSettingTab(new GitLiteSettingTab(this.app, this));

    this.addCommand({
      id: 'git-pull',
      name: 'Git: Pull',
      callback: () => this.runTracked('pull', () => this.scheduler.pull()),
    });

    this.addCommand({
      id: 'git-commit-push',
      name: 'Git: Commit & push',
      callback: () => this.runTracked('push', () => this.scheduler.commitAndPush()),
    });

    this.addCommand({
      id: 'git-status',
      name: 'Git: Status',
      callback: () => this.runTracked('status', () => this.scheduler.status()),
    });

    await ensureGitignore(this.app);
    this.onAutoSyncSettingChanged();
  }

  onunload() {
    // registerEvent/addCommand handle their own teardown.
  }

  onAutoSyncSettingChanged(): void {
    if (this.settings.autoSync.enabled && !this.autoSyncRegistered) {
      this.scheduler.registerAutoSync(this);
      this.autoSyncRegistered = true;
    }
    // Listeners are registered via this.registerEvent() inside
    // registerAutoSync(), so they're torn down automatically on unload.
    // Toggling the setting off takes effect immediately: the debounce
    // timer still fires but isAutoSyncEnabled() gates the actual sync,
    // so nothing runs until it's turned back on.
  }

  private setStatusBarText(text: string): void {
    this.statusBarEl.setText(text);
  }

  private async runTracked(label: string, fn: () => Promise<void>): Promise<void> {
    this.setStatusBarText(`Git Lite: ${label}…`);
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Git Lite: ${label} failed: ${message}`);
    } finally {
      this.setStatusBarText(Platform.isDesktopApp ? 'Git Lite (desktop)' : 'Git Lite (mobile)');
    }
  }

  async loadSettings() {
    const loaded = ((await this.loadData()) ?? {}) as Partial<GitLiteSettings>;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      git: { ...DEFAULT_SETTINGS.git, ...(loaded.git ?? {}) },
      secrets: { ...DEFAULT_SETTINGS.secrets, ...(loaded.secrets ?? {}) },
      autoSync: { ...DEFAULT_SETTINGS.autoSync, ...(loaded.autoSync ?? {}) },
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
