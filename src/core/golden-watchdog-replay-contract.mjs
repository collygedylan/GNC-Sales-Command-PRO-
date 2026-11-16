import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {createDatabaseWorkspace} from '../../scripts/database-workspace.mjs';

export function assertWatchdogReviewerReplay() {
  const root=path.resolve(import.meta.dirname,'../..');
  const workspace=createDatabaseWorkspace({root});
  try {
    const directory=path.join(workspace.root,'supabase/migrations');
    const names=readdirSync(directory).sort();
    const target='20261111174727_access_defaults_watchdog_read.sql';
    const index=names.indexOf(target);
    assert.equal(names[index-1],'20261111174726_ci_canonical_watchdog_reviewers.sql');
    assert.equal(names[index+1],'20261111174728_ci_canonical_watchdog_reviewers_cleanup.sql');
    assert.equal(readFileSync(path.join(directory,target),'utf8'),
      readFileSync(path.join(root,'supabase/migrations',target),'utf8').replaceAll('\r\n','\n'));
    const fixture=readFileSync(path.join(directory,names[index-1]),'utf8');
    assert.match(fixture,/CANONICAL_WATCHDOG_REVIEWER_FIXTURE_ONLY/);
    assert.match(fixture,/coalesce\(lower\(actor\.username\),''\) NOT IN \('dylan_collyge','megan_kelly','jd_jones'\)/);
    assert.match(fixture,/WATCHDOG_REVIEW_UNCONFIRMED/);
    assert.equal((fixture.match(/@fixture\.invalid/g)||[]).length,3);
    const cleanup=readFileSync(path.join(directory,names[index+1]),'utf8');
    assert.match(cleanup,/CANONICAL_WATCHDOG_REVIEWER_RECEIPT_CHANGED/);
    assert.doesNotMatch(cleanup,/delete from private\.runtime_watchdog_reviewers/i);
  } finally { workspace.dispose(); }
}

export function assertManualSyncContract(runFunctions,functionSource) {
  const code = runFunctions('Code.gs', ['getManualSyncStageOrder_'], { MANUAL_SYNC_STAGE_ORDER_DEFAULT: ['drive', 'soc', 'reserves', 'cav'], String });
  assert.deepEqual(Array.from(code.getManualSyncStageOrder_('all')), ['drive', 'soc', 'reserves', 'cav']);
  const runtime = runFunctions('assets/app-runtime.js', ['dashboardFilenameTimestamp', 'selectDashboardSyncFilename']);
  assert.equal(runtime.selectDashboardSyncFilename(['DriveAround_20261022090000.xlsx', 'DriveAround_20261023123000.xlsx']), 'DriveAround_20261023123000.xlsx');
  assert.match(functionSource('assets/app-runtime.js', 'runGoogleAppsScriptTrigger'), /force:\s*true/);
  assert.match(functionSource('Code.gs', 'queueManualSyncRequest_'), /force/);
  assert.match(functionSource('Code.gs', 'moveAndNormalizeDriveAroundProcessedFiles_'), /processedFolder/);
}
