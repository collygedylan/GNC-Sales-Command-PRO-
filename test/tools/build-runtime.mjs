import fs from 'node:fs/promises';
import path from 'node:path';
import { minify } from 'terser';
import { readComposedRuntimeSource } from '../../scripts/composed-app-source.mjs';
export async function buildTestRuntime(root) {
  const source = readComposedRuntimeSource({ directory: path.join(root, 'test') });
  if (source.includes('https://kzrnyjsosryejjejliii.supabase.co')) throw Error('PRODUCTION_ENDPOINT_IN_TEST');
  const result = await minify(source, { compress: false, mangle: false, module: false, keep_fnames: true, keep_classnames: true, format: { comments: false } });
  if (!result.code) throw Error('EMPTY_TEST_RUNTIME');
  await fs.writeFile(path.join(root, 'test/assets/live-app-runtime-v2026082010.min.js'), result.code + '\n;window.__gncAppRuntimeExecuted = true;\n');
}
