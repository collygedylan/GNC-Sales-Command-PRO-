import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {createDatabaseWorkspace} from '../../scripts/database-workspace.mjs';

export function assertCrossLayerSeam(read,runFunctions) {
  const normalizer = runFunctions('assets/app-runtime.js', ['normalizeDriveEvidenceLocationPart'], {});
  assert.equal(normalizer.normalizeDriveEvidenceLocationPart(' e.10.000 '), 'E.10.000');
  const migration = read('supabase/migrations/20261023220000_drive_location_evidence_and_request_reconciliation_v1.sql');
  const api = read('supabase/functions/app-api/index.ts');
  const appsScript = read('Code.gs');
  for (const key of ['itemcode', 'locationcode', 'lotcode']) {
    assert.match(migration, new RegExp(`\\b${key}\\b`));
    assert.match(api, new RegExp(`\\b${key}\\b`, 'i'));
    assert.match(appsScript, new RegExp(`\\b${key}\\b`, 'i'));
  }
  assert.match(migration, /inventory_location_evidence_v1[^]*reconcile_active_requests_from_outbox_v1/);
  assert.doesNotMatch(migration, /delete from public\.ph_active_request/i);
}

export function assertReclassActorReplay() {
  const root=path.resolve(import.meta.dirname,'../..');
  const workspace=createDatabaseWorkspace({root});
  try {
    const directory=path.join(workspace.root,'supabase/migrations');
    const names=readdirSync(directory).sort();
    const target='20261111204840_agdata3076_reclass_y_authority.sql';
    const index=names.indexOf(target);
    assert.equal(names[index-1],'20261111204839_ci_canonical_reclass_actors.sql');
    assert.equal(readFileSync(path.join(directory,target),'utf8'),readFileSync(path.join(root,'supabase/migrations',target),'utf8').replaceAll('\r\n','\n'));
    const fixture=readFileSync(path.join(directory,names[index-1]),'utf8');
    assert.match(fixture,/CANONICAL_RECLASS_ACTOR_FIXTURE_ONLY/);
    assert.match(fixture,/CANONICAL_RECLASS_ACTOR_ANCHOR_MISSING/);
    assert.match(fixture,/p_actor.disabled_at IS NULL/);
    assert.match(fixture,/u.edit_any_row='Y'/);
    assert.doesNotMatch(fixture,/update public\.ph_master_inventory/i);
  } finally { workspace.dispose(); }
}
