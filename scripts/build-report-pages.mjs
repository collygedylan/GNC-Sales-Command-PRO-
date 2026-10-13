import { build } from 'esbuild';

await build({
  entryPoints: ['services/reportPages.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  minify: true,
  outfile: 'assets/report-pages.js'
});
