import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function compileBunchQueue({ root = process.cwd() } = {}) {
  const result = await build({ absWorkingDir: root, entryPoints: ['components/bunch-queue/mount.tsx'], bundle: true,
    format: 'esm', platform: 'browser', target: 'es2020', jsx: 'automatic', minify: true,
    write: false, metafile: true, outfile: 'assets/bunch-queue.js' });
  const outputs = new Map(result.outputFiles.map(file => [file.path, Buffer.from(file.contents)]));
  const cssInput = 'components/bunch-queue/bunch-queue.css';
  outputs.set(path.join(root, 'assets/bunch-queue.css'), await readFile(path.join(root, cssInput)));
  return { outputs, inputs: [...Object.keys(result.metafile.inputs), cssInput] };
}

export async function buildBunchQueue(root = process.cwd()) {
  const { outputs } = await compileBunchQueue({ root });
  for (const [file, bytes] of outputs) await writeFile(file, bytes);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildBunchQueue();
