import { verifyV2314RetainedValidation } from './check-v2314-retained-validation.mjs';
import { verifyV2313RetainedValidation } from './check-v2313-retained-validation.mjs';
import { verifyV2312RetainedValidation } from './check-v2312-retained-validation.mjs';
import { verifyV2311RetainedValidation } from './check-v2311-retained-validation.mjs';
import { verifyV2310RetainedValidation } from './check-v2310-retained-validation.mjs';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { discoverTests } from './test-discovery.mjs';
import { verifyV239RetainedValidation } from './check-v239-retained-validation.mjs';

export function backendTestMatrices({ root } = {}) {
  const repositoryRoot = path.resolve(root || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const packageVersion = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).version;
  const pglite = discoverTests({ root, group: 'pglite' });
  const entrypoints = discoverTests({ root, group: 'deno-entrypoints' });
  const tests = discoverTests({ root, group: 'deno-tests' });

  if (packageVersion === '2.3.14') {
    verifyV2314RetainedValidation({ rootDir: repositoryRoot });
    return { pglite: ['scripts/check-v2314-retained-validation.mjs'], edge: { include: [
      { suite: 'suspend-source-freshness', targets: ['supabase/functions/app-api/index.ts', 'supabase/functions/app-api/suspend-tag-read_test.ts'], tests: ['supabase/functions/app-api/suspend-tag-read_test.ts'] },
    ] } };
  }
  if (packageVersion === '2.3.13') {
    verifyV2313RetainedValidation({ rootDir: repositoryRoot });
    return { pglite: ['scripts/check-v2313-retained-validation.mjs'], edge: { include: [] } };
  }
  if (packageVersion === '2.3.12') {
    verifyV2312RetainedValidation({ rootDir: repositoryRoot });
    return { pglite: [], edge: { include: [] } };
  }
  if (packageVersion === '2.3.11') {
    verifyV2311RetainedValidation({ rootDir: repositoryRoot });
    return { pglite: ['scripts/check-v2311-retained-validation.mjs'], edge: { include: [
      { suite: 'app-api-static', targets: ['supabase/functions/app-api/index.ts'], tests: [] },
      { suite: 'delivery-static', targets: ['supabase/functions/request-delivery-worker/index.ts'], tests: [] },
    ] } };
  }
  if (packageVersion === '2.3.10') {
    verifyV2310RetainedValidation({ rootDir: repositoryRoot });
    return { pglite: [], edge: { include: [{ suite: 'app-api-static', targets: ['supabase/functions/app-api/index.ts'], tests: [] }] } };
  }
  if (packageVersion === '2.3.9') {
    verifyV239RetainedValidation({ rootDir: repositoryRoot });
    return {
      pglite: [],
      edge: { include: [{ suite: 'app-api-static', targets: ['supabase/functions/app-api/index.ts'], tests: [] }] },
    };
  }

  if (packageVersion === '2.3.8') {
    const requiredPglite = 'supabase/ci/suspend_tag_sender_identity_pglite.mjs';
    const requiredEntrypoints = [
      'supabase/functions/app-api/index.ts',
      'supabase/functions/request-delivery-worker/index.ts',
      'supabase/functions/send-push-alert/index.ts',
    ];
    if (!pglite.includes(requiredPglite)) throw new Error(`V238_REQUIRED_PGLITE_MISSING:${requiredPglite}`);
    for (const file of requiredEntrypoints) {
      if (!entrypoints.includes(file)) throw new Error(`V238_REQUIRED_EDGE_ENTRYPOINT_MISSING:${file}`);
    }
    const groups = requiredEntrypoints.map(file => ({
      suite: file.split('/').slice(0, 3).join('/'),
      targets: [file],
      tests: [],
    }));
    return { pglite: [requiredPglite], edge: { include: groups } };
  }

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
