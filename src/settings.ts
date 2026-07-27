import { App, PluginSettingTab, Setting } from 'obsidian';
import type GitLitePlugin from './main';
import { decryptSecret, encryptSecret, secretStorageDescription } from './secureStorage';

export interface GitSettings {
  remoteUrl: string;
  branch: string;
}

export interface GitLiteSecrets {
  gitToken: string;
}

export interface GitLiteSettings {
  git: GitSettings;
  secrets: GitLiteSecrets;
}

export const DEFAULT_SETTINGS: GitLiteSettings = {
  git: {
    remoteUrl: '',
    branch: 'main',
  },
  secrets: {
    gitToken: '',
  },
};

export class GitLiteSettingTab extends PluginSettingTab {
  plugin: GitLitePlugin;

  constructor(app: App, plugin: GitLitePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.render();
  }

  private async save() {
    await this.plugin.saveSettings();
  }

  render(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    containerEl.createEl('h2', { text: 'Git sync' });
    containerEl.createEl('p', {
      text:
        'Desktop only. Assumes your vault root is already a git repository (git init/clone it yourself first). ' +
        'Pull, Commit & push, and Status are available as commands (Cmd/Ctrl+P).',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Remote URL')
      .setDesc('e.g. https://github.com/you/your-vault.git')
      .addText((text) =>
        text.setValue(s.git.remoteUrl).onChange(async (value) => {
          s.git.remoteUrl = value.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Branch')
      .addText((text) =>
        text.setValue(s.git.branch).onChange(async (value) => {
          s.git.branch = value.trim() || 'main';
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Personal access token')
      .setDesc(secretStorageDescription() + ' Used as a Basic-auth header on pull/push — never written to .git/config.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setValue(decryptSecret(s.secrets.gitToken)).onChange(async (value) => {
          s.secrets.gitToken = encryptSecret(value.trim());
          await this.save();
        });
      });
  }
}
