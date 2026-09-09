//@ts-check
'use strict';

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
};

/** @type {import('esbuild').BuildOptions} */
const hexWebviewConfig = {
  ...common,
  entryPoints: ['src/webview/main.ts'],
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
};

/** @type {import('esbuild').BuildOptions} */
const formatEditorWebviewConfig = {
  ...common,
  entryPoints: ['src/webview/formatEditor/main.ts'],
  outfile: 'dist/formatEditor.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
};

async function main() {
  const configs = [extensionConfig, hexWebviewConfig, formatEditorWebviewConfig];
  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[esbuild] watching...');
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    console.log('[esbuild] build complete');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
