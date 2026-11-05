import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { synchronizeGemBus, validateIncident, renderGemContract } from '../scripts/sync-gem-learning-bus.mjs';
import { assertRealtimeQuotaContract } from './helpers/realtime-quota-contract.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../docs/architecture/gem-contracts.json', import.meta.url), 'utf8'));
test('all 118 required Gems and retained skills have reciprocal, synchronized contracts', () => {
  const result = synchronizeGemBus({ check: true });
  assert.equal(result.required, 118); assert.ok(result.total >= 118); assert.equal(result.changedFiles, 0);
});
test('an incident reaches both twins and rejects an unknown owner or missing proof', () => {
  const incident = catalog.incidents[0], owner = catalog.gems.find(g => g.name === incident.owners[0]);
  assert.match(renderGemContract(owner, catalog), new RegExp(incident.id));
  assert.match(renderGemContract(catalog.gems.find(g => g.name === owner.twin), catalog), new RegExp(incident.id));
  assert.throws(() => validateIncident({ ...incident, owners: ['unknown'] }, catalog), /OWNER_INVALID/);
  assert.throws(() => validateIncident({ ...incident, evidence: '' }, catalog), /FIELD_REQUIRED/);
  assert.throws(() => validateIncident({ ...incident, rule: 'Bearer secret' }, catalog), /SECRET_FORBIDDEN/);
});
test('revision bursts debounce, view switches reuse one channel and reset cancels pending reads', () => assertRealtimeQuotaContract());
