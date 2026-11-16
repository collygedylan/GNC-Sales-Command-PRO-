import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {compileCanonicalMasterStagingFixture,HISTORICAL_MASTER_STAGING_FIXTURE} from './canonical-master-staging-fixture.mjs';

export function writeCanonicalStagingFixture(root,workspaceRoot) {
  const workspace=path.resolve(workspaceRoot);
  assert.notEqual(workspace,path.resolve(root),'canonical fixture cannot overwrite repository inputs');
  const directory=path.join(workspace,'canonical-fixtures');
  const target=path.join(directory,'master_snapshot_chunked_staging_v1_test.sql');
  const read=file=>readFileSync(path.join(root,file),'utf8');
  const source=compileCanonicalMasterStagingFixture(read(HISTORICAL_MASTER_STAGING_FIXTURE),read);
  mkdirSync(directory,{recursive:true});
  writeFileSync(target,source);
  return target;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length,4,'Usage: canonical-staging-fixture-writer.mjs <repository> <disposable-workspace>');
  writeCanonicalStagingFixture(process.argv[2],process.argv[3]);
}
