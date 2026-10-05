import { build } from 'esbuild';
await build({ entryPoints: ['components/bunch-notes/StructuredBunchNote.jsx'], bundle: true,
  format: 'esm', platform: 'browser', target: 'es2020', jsx: 'automatic', minify: true,
  outfile: 'assets/bunch-note-structured.js' });
