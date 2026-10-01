import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: ['components/command-center/fieldCommandCenter.jsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  minify: true,
  outfile: 'assets/alpha-command-center.js',
});
await copyFile('styles/alpha-command-center.css', 'assets/alpha-command-center.css');
