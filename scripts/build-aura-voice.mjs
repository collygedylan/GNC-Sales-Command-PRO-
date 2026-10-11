import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildAuraVoice({ root = process.cwd() } = {}) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['components/common/auraVoiceReact.tsx'],
    bundle: true,
    splitting: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    minify: true,
    write: false,
  });
  const output = result.outputFiles?.[0];
  if (!output || !output.text.includes('mountAuraWidgetReact')) throw new Error('AURA_REACT_ENTRY_MISSING');
  const destination = join(root, 'assets/aura-voice.js');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output.contents);
  return destination;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildAuraVoice();
