import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  // Only Node builtins are external on desktop's Electron runtime — the
  // SimpleGit backend uses fs/child_process/path directly, and those calls
  // are gated behind Platform.isDesktopApp so they're never hit in the
  // mobile bundle. isomorphic-git itself IS bundled (not external) since
  // there's no equivalent package on the mobile runtime to defer to.
  external: ['obsidian', 'electron', ...builtins],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
  // isomorphic-git (via its deps, e.g. safe-buffer) expects a global Buffer.
  // Electron's desktop runtime has this natively; Obsidian mobile's
  // WebView/React-Native-ish JS runtime does not, which is the exact
  // failure mode reported in the community forum thread on this combo.
  define: { global: 'globalThis' },
  inject: ['esbuild-shims.js'],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
