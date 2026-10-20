// @test-group: @release-validation
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');

test('Docker validation pins Playwright, uses cached dependencies, and preserves linked-worktree Git identity', () => {
  const dockerfile = read('Dockerfile.validation');
  const compose = yaml.safeLoad(read('docker-compose.validation.yml'));
  const wrapper = read('scripts/validation/run-release-smoke-container.mjs');
  const docs = read('scripts/validation/README.md');

  assert.match(dockerfile, /playwright:v1\.62\.1-noble/);
  assert.match(dockerfile, /RUN --mount=type=cache,target=\/root\/\.npm npm ci/);
  assert.match(dockerfile, /^# syntax=docker\/dockerfile:1/m);
  assert.equal(compose.services['release-smoke'].volumes.find(volume => volume.target === '/workspace/node_modules').source, 'validation_node_modules');
  assert.equal(compose.services['release-smoke'].volumes.find(volume => volume.target === '/ms-playwright').source, 'validation_playwright_cache');
  assert.equal(compose.services['release-smoke'].environment.GIT_DIR, '/git/worktree');
  assert.equal(compose.services['release-smoke'].environment.GIT_COMMON_DIR, '/git/common');
  assert.equal(compose.services['release-smoke'].volumes.find(volume => volume.target === '/git/worktree').read_only, true);
  assert.equal(compose.services['release-smoke'].volumes.find(volume => volume.target === '/git/common').read_only, true);
  assert.equal(compose.volumes.validation_node_modules.name, 'validation_node_modules_v1_62_1');
  assert.equal(compose.volumes.validation_playwright_cache.name, 'validation_playwright_cache_v1_62_1');
  assert.match(wrapper, /VALIDATION_PLAYWRIGHT_BROWSER_CACHE_PIN_MISSING/);
  assert.match(docs, /GIT_WORKTREE_ADMIN_DIR/);
  assert.match(docs, /read-only/);
});

test('PostgreSQL 15 auxiliary service is optional and disposable with minimal Supabase roles', () => {
  const compose = yaml.safeLoad(read('docker-compose.validation.yml'));
  const bootstrap = read('scripts/validation/postgres15-bootstrap.sql');
  const docs = read('scripts/validation/README.md');

  assert.equal(compose.services['postgres15-aux'].image, 'postgres:15-alpine');
  assert.deepEqual(compose.services['postgres15-aux'].profiles, ['postgres15-aux']);
  assert.deepEqual(compose.services['postgres15-aux'].tmpfs, ['/var/lib/postgresql/data:rw,noexec,nosuid,size=1g']);
  for (const role of ['anon', 'authenticated', 'service_role']) assert.match(bootstrap, new RegExp(`CREATE ROLE ${role}`));
  assert.match(bootstrap, /CREATE SCHEMA IF NOT EXISTS auth/);
  // Parse the deliberately small bootstrap grammar without executing SQL or a database.
  const statements = bootstrap.replace(/^--.*$/gm, '').trim();
  const roleStatements = [...statements.matchAll(/DO \$\$ BEGIN CREATE ROLE (\w+) NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END; \$\$;/g)];
  assert.deepEqual(roleStatements.map(match => match[1]), ['anon', 'authenticated', 'service_role']);
  let remainder = statements;
  for (const [statement] of roleStatements) remainder = remainder.replace(statement, '');
  assert.equal(remainder.trim(), 'CREATE SCHEMA IF NOT EXISTS auth;');
  assert.match(docs, /Supabase CLI/);
  assert.match(docs, /PostgreSQL 17/);
});
