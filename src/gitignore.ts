import { App } from 'obsidian';

/**
 * Obsidian writes local-machine UI state (last open pane, sidebar width,
 * plugin caches) into .obsidian/*, and a `.trash/` folder for deleted
 * notes. None of that should sync — it creates noisy diffs on every
 * device and can leak one device's window layout into another's. Both
 * native git and isomorphic-git read .gitignore automatically, so this
 * only needs to make sure a reasonable one exists; it never overwrites
 * a .gitignore the user already customized.
 */
const DEFAULT_IGNORES = [
  '# Added by Git Lite — safe to edit.',
  '.obsidian/workspace.json',
  '.obsidian/workspace-mobile.json',
  '.obsidian/cache',
  '.obsidian/plugins/*/data.json',
  '.trash/',
  '.DS_Store',
];

export async function ensureGitignore(app: App): Promise<void> {
  const path = '.gitignore';
  if (await app.vault.adapter.exists(path)) return;
  await app.vault.adapter.write(path, DEFAULT_IGNORES.join('\n') + '\n');
}
