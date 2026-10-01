import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: ['pages/managers/ProductionSchedule.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  outfile: 'assets/production-schedule.js',
});
await copyFile('styles/production-schedule.css', 'assets/production-schedule.css');
