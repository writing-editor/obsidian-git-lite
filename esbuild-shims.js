// Injected via esbuild's `inject` option. Desktop (Electron) already has a
// global Buffer; this only matters on Obsidian mobile's runtime, which
// doesn't. isomorphic-git's dependency chain (safe-buffer et al.) assumes
// Buffer exists globally — without this shim, mobile throws
// "TypeError: buffer.Buffer is not a constructor" the first time
// isomorphic-git touches a git object. See:
// https://forum.obsidian.md/t/notes-on-getting-isomorphic-git-or-safe-buffer-work-on-mobile/90229
import { Buffer as BufferPolyfill } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = BufferPolyfill;
}

export { BufferPolyfill as Buffer };
