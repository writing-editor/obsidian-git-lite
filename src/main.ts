import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, GitLiteSettings, GitLiteSettingTab } from './settings';
import { gitCommitAndPush, gitPull, gitStatus } from './gitSync';
import { decryptSecret } from './secureStorage';

export default class GitLitePlugin extends Plugin {
  settings: GitLiteSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new GitLiteSettingTab(this.app, this));

    this.addCommand({
      id: 'git-pull',
      name: 'Git: Pull',
      callback: () =>
        gitPull(this.app, this.settings.git, decryptSecret(this.settings.secrets.gitToken)).catch((err) =>
          new Notice(`Git Lite: pull failed: ${err.message ?? err}`)
        ),
    });

    this.addCommand({
      id: 'git-commit-push',
      name: 'Git: Commit & push',
      callback: () =>
        gitCommitAndPush(this.app, this.settings.git, decryptSecret(this.settings.secrets.gitToken)).catch((err) =>
          new Notice(`Git Lite: commit/push failed: ${err.message ?? err}`)
        ),
    });

    this.addCommand({
      id: 'git-status',
      name: 'Git: Status',
      callback: () =>
        gitStatus(this.app, this.settings.git).catch((err) => new Notice(`Git Lite: status failed: ${err.message ?? err}`)),
    });
  }

  onunload() {
    // registerEvent/addCommand handle their own teardown.
  }

  async loadSettings() {
    const loaded = (await this.loadData()) ?? {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      git: { ...DEFAULT_SETTINGS.git, ...(loaded.git ?? {}) },
      secrets: { ...DEFAULT_SETTINGS.secrets, ...(loaded.secrets ?? {}) },
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
