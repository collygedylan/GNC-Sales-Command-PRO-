import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { disposableDatabaseConfig } from '../../src/services/disposable-database-config.mjs';
import { prepareHistoricalDatabaseFixture } from '../../scripts/historical-database-fixture.mjs';

export function assertDisposableDatabasePorts() {
  const config = 'project_id = "original"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\nmajor_version = 17\n';
  const isolated = disposableDatabaseConfig(config, 'fixture', count => Array.from({ length: count }, (_, i) => 55000 + i));
  assert.match(isolated, /project_id = "fixture"/);
  assert.match(isolated, /\[api\]\nport = 55000/);
  assert.match(isolated, /\[db\]\nport = 55001\nshadow_port = 55002\nmajor_version = 17/);
  assert.throws(() => disposableDatabaseConfig(config, 'fixture', () => [55000, 55000, 55000]), /PORTS_INVALID/);
  assert.throws(() => disposableDatabaseConfig(config, 'fixture', () => [80, 81, 82]), /PORTS_INVALID/);
  assert.throws(() => disposableDatabaseConfig(config, 'fixture', () => []), /PORTS_INVALID/);
  assert.throws(() => disposableDatabaseConfig('[db]\nport = 54322', 'fixture'), /PROJECT_ID_CONFIG_INVALID/);
  assert.match(config, /port = 54322/);
}

export function assertHistoricalRuntimeClosure() {
  const root = path.resolve(import.meta.dirname, '../..');
  const fixture = prepareHistoricalDatabaseFixture({ root });
  try {
    for (const relative of ['src/core/erp-secondary-stage.mjs', 'services/database-contract-runtime.ts', 'utils/auraLingo.js']) {
      assert.ok(existsSync(path.join(fixture.root, relative)), relative);
      assert.equal(readFileSync(path.join(fixture.root, relative), 'utf8'), readFileSync(path.join(root, relative), 'utf8'));
    }
    const config = readFileSync(path.join(fixture.root, 'supabase/config.toml'), 'utf8');
    assert.doesNotMatch(config, /^port = 54322$/m);
  } finally { fixture.dispose(); }
}
