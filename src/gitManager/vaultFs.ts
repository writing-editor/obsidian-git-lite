import { DataAdapter } from 'obsidian';

/**
 * isomorphic-git wants a callback-style Node `fs` (or the lightweight-fs
 * promise style it also accepts internally via `fs.promises`). Obsidian's
 * DataAdapter is promise-based and vault-relative, so this wraps it.
 *
 * Deliberately minimal — only the calls isomorphic-git's `http`/`clone`/
 * `fetch`/`commit`/`status` paths actually make. If a future isomorphic-git
 * feature needs more, extend here.
 */
export class VaultFs {
  constructor(private adapter: DataAdapter) {}

  promises = {
    readFile: async (path: string, opts?: { encoding?: string } | string): Promise<Uint8Array | string> => {
      const encoding = typeof opts === 'string' ? opts : opts?.encoding;
      if (encoding === 'utf8') return this.adapter.read(path);
      const buf = await this.adapter.readBinary(path);
      return new Uint8Array(buf);
    },

    writeFile: async (path: string, data: Uint8Array | string): Promise<void> => {
      await this.ensureParentDir(path);
      if (typeof data === 'string') {
        await this.adapter.write(path, data);
      } else {
        await this.adapter.writeBinary(path, this.toArrayBuffer(data));
      }
    },

    unlink: async (path: string): Promise<void> => {
      if (await this.adapter.exists(path)) await this.adapter.remove(path);
    },

    readdir: async (path: string): Promise<string[]> => {
      const listing = await this.adapter.list(path);
      const files = listing.files.map((p) => p.split('/').pop()!);
      const folders = listing.folders.map((p) => p.split('/').pop()!);
      return [...folders, ...files];
    },

    mkdir: async (path: string): Promise<void> => {
      if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
    },

    rmdir: async (path: string): Promise<void> => {
      if (await this.adapter.exists(path)) await this.adapter.rmdir(path, false);
    },

    stat: async (path: string) => this.statLike(path, false),
    lstat: async (path: string) => this.statLike(path, true),

    rename: async (from: string, to: string): Promise<void> => {
      await this.ensureParentDir(to);
      await this.adapter.rename(from, to);
    },

    readlink: async (): Promise<never> => {
      throw new Error('Symlinks are not supported inside an Obsidian vault.');
    },
    symlink: async (): Promise<never> => {
      throw new Error('Symlinks are not supported inside an Obsidian vault.');
    },
  };

  private async ensureParentDir(path: string): Promise<void> {
    const parent = path.split('/').slice(0, -1).join('/');
    if (!parent) return;
    if (!(await this.adapter.exists(parent))) {
      await this.mkdirp(parent);
    }
  }

  private async mkdirp(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.adapter.exists(cur))) {
        await this.adapter.mkdir(cur);
      }
    }
  }

  private toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }

  private async statLike(path: string, _isLstat: boolean) {
    const exists = await this.adapter.exists(path);
    if (!exists) {
      const err = new Error(`ENOENT: ${path}`) as Error & { code: string };
      err.code = 'ENOENT';
      throw err;
    }
    const stat = await this.adapter.stat(path);
    const isDir = stat?.type === 'folder';
    return {
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
      size: stat?.size ?? 0,
      mtimeMs: stat?.mtime ?? Date.now(),
      ctimeMs: stat?.ctime ?? Date.now(),
      mode: 0o666,
      dev: 0,
      ino: 0,
    };
  }
}
