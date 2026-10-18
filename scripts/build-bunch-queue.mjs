import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function buildBunchQueue(root = process.cwd()) {
  await build({ absWorkingDir: root, entryPoints: ['components/bunch-queue/mount.tsx'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', jsx: 'automatic', minify: true, outfile: 'assets/bunch-queue.js' });
  await copyFile(`${root}/components/bunch-queue/bunch-queue.css`, `${root}/assets/bunch-queue.css`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildBunchQueue();
