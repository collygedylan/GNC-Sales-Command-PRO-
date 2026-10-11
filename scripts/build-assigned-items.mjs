import { build } from 'esbuild';

await build({
  entryPoints: ['components/assigned-items/AssignedItems.jsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  minify: true,
  outfile: 'assets/assigned-items-table.js'
});
