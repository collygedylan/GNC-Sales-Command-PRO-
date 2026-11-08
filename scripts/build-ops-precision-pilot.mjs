import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function compileOpsPrecisionPilot({ root = process.cwd() } = {}) {
  const result = await build({
    absWorkingDir: root, entryPoints: ['src/ui/ops-pilot-entry.js'],
    bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
    minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, write: false, metafile: true, outfile: 'assets/ops-precision-pilot.js'
  });
  return { outputs: new Map(result.outputFiles.map(file => [file.path, Buffer.from(file.contents)])),
    inputs: Object.keys(result.metafile.inputs) };
}

export async function buildOpsPrecisionPilot(options = {}) {
  const { outputs } = await compileOpsPrecisionPilot(options);
  for (const [file, bytes] of outputs) await writeFile(file, bytes);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildOpsPrecisionPilot();
