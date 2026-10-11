import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { discoverTests } from './test-discovery.mjs';

export function backendTestMatrices({ root } = {}) {
  const pglite = discoverTests({ root, group: 'pglite' });
  const entrypoints = discoverTests({ root, group: 'deno-entrypoints' });
  const tests = discoverTests({ root, group: 'deno-tests' });
  const groups = new Map();
  for (const file of [...entrypoints, ...tests]) {
    const suite = file.split('/').slice(0, 3).join('/');
    if (!groups.has(suite)) groups.set(suite, { suite, targets: [], tests: [] });
    const group = groups.get(suite);
    if (!group.targets.includes(file)) group.targets.push(file);
    if (tests.includes(file)) group.tests.push(file);
  }
  if (!pglite.length || !entrypoints.length || !tests.length) throw new Error('BACKEND_TEST_MATRIX_EMPTY');
  return { pglite, edge: { include: [...groups.values()] } };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT_REQUIRED');
  const matrices = backendTestMatrices();
  for (const [name, matrix] of Object.entries(matrices)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${JSON.stringify(matrix)}\n`);
  }
}
