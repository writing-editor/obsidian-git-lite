import { App, PluginSettingTab, Setting } from 'obsidian';
import type GitLitePlugin from './main';
import { decryptSecret, encryptSecret, secretStorageDescription } from './secureStorage';

export interface GitSettings {
  remoteUrl: string;
  branch: string;
  /** Shallow-history depth for clone/fetch. Small on purpose — see gitManager/isomorphicGit.ts notes on mobile cost. */
  depth: number;
}

export interface GitLiteSecrets {
  gitToken: string;
}

export interface AutoSyncSettings {
  enabled: boolean;
  debounceSeconds: number;
}

export interface GitLiteSettings {
  git: GitSettings;
  secrets: GitLiteSecrets;
  autoSync: AutoSyncSettings;
}

export const DEFAULT_SETTINGS: GitLiteSettings = {
  git: {
    remoteUrl: '',
    branch: 'main',
    depth: 3,
  },
  secrets: {
    gitToken: '',
  },
  autoSync: {
    enabled: false,
    debounceSeconds: 20,
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
        'Works on desktop (native git) and mobile (isomorphic-git). On first ' +
        'run against an empty vault, Git Lite clones the remote for you; ' +
        'against an existing vault it initializes a repo and fetches. ' +
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
      .setName('Clone/fetch depth')
      .setDesc(
        'How many recent commits to keep. Shallow on purpose — full history is rarely needed for note-taking ' +
          'and mobile (isomorphic-git) is memory-constrained, so smaller is safer. 3 is a good default; ' +
          'raise it only if you actually need to browse older history.'
      )
      .addText((text) =>
        text.setValue(String(s.git.depth)).onChange(async (value) => {
          const parsed = parseInt(value, 10);
          s.git.depth = Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
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

    containerEl.createEl('h3', { text: 'Auto-sync' });

    new Setting(containerEl)
      .setName('Enable auto-sync')
      .setDesc('Commit & push automatically after edits settle down, instead of only on manual command.')
      .addToggle((toggle) =>
        toggle.setValue(s.autoSync.enabled).onChange(async (value) => {
          s.autoSync.enabled = value;
          await this.save();
          this.plugin.onAutoSyncSettingChanged();
        })
      );

    new Setting(containerEl)
      .setName('Debounce (seconds)')
      .setDesc('Wait this long after your last edit before auto-syncing, so rapid edits batch into one commit.')
      .addText((text) =>
        text.setValue(String(s.autoSync.debounceSeconds)).onChange(async (value) => {
          const parsed = parseInt(value, 10);
          s.autoSync.debounceSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
          await this.save();
        })
      );
  }
}
