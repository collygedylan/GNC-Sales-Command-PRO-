import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createDatabaseWorkspace } from '../../scripts/database-workspace.mjs';

export function assertPhotoAuthorizationReplayPrerequisite() {
  const root=path.resolve(import.meta.dirname,'../..');
  const workspace=createDatabaseWorkspace({root});
  try {
    const directory=path.join(workspace.root,'supabase/migrations');
    const names=readdirSync(directory).sort();
    const prerequisite='20261111173945_ci_canonical_photo_authorization_version.sql';
    const migration='20261111173946_photo_request_table_authorization.sql';
    assert.equal(names[names.indexOf(prerequisite)+1],migration);
    const source=readFileSync(path.join(directory,prerequisite),'utf8');
    assert.match(source,/ci_schema_workspace_guard/);
    assert.match(source,/CANONICAL_PHOTO_VERSION_FIXTURE_ONLY/);
    assert.match(source,/"app_version":"3\.0\.72"/);
    assert.equal(readFileSync(path.join(directory,migration),'utf8'),
      readFileSync(path.join(root,'supabase/migrations',migration),'utf8').replaceAll('\r\n','\n'));
  } finally { workspace.dispose(); }
}

export function assertEvalBlockLocationDrill(locationContext) {
  const context = locationContext();
  const codes = ['C.05.026', 'C.06.000', 'C.05.017', 'C.05.000'];
  const groups = context.LocationCode.group(codes);
  assert.deepEqual(Array.from(groups.keys()), ['C.05', 'C.06']);
  assert.deepEqual(Array.from(groups.get('C.05')), ['C.05.000', 'C.05.017', 'C.05.026']);
  assert.equal(context.LocationCode.base('C.05.017'), 'C.05');
  assert.equal(context.LocationCode.normalize('c.05.017').startsWith('C'), true);
}
