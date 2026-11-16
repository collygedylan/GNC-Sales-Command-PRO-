import path from 'node:path';
import {HISTORICAL_MASTER_STAGING_FIXTURE} from './canonical-master-staging-fixture.mjs';

export function runCanonicalCommittedSqlTests({root,workspaceRoot,files,runCli,executeNode}) {
  for(const [index,file] of files.entries()) {
    if(index>0) runCli(['db','reset','--local','--no-seed']);
    let target=path.resolve(root,file);
    if(file===HISTORICAL_MASTER_STAGING_FIXTURE) {
      target=path.join(workspaceRoot,'canonical-fixtures','master_snapshot_chunked_staging_v1_test.sql');
      executeNode([path.join(root,'src/services/canonical-staging-fixture-writer.mjs'),root,workspaceRoot],{cwd:root});
    }
    runCli(['test','db',target]);
  }
}
