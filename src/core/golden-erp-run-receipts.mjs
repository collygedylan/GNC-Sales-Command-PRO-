import assert from 'node:assert/strict';
import {stampErpSnapshotFilename} from '../../supabase/functions/_shared/erp-sync.mjs';
import {confirmedErpRunTime, latestErpHomeTimestamp} from './erp-foreground-recovery.js';

export function assertSnapshotFilenameEvidence() {
    const input = [
        {unique_id:'soc', filename:'old.xlsx', spec:'saved'},
        {values:{unique_id:'master', filename:'old.xlsx', photos:['saved.jpg'], pick_note:'keep'}, rawFields:['itemcode']}
    ];
    const output = stampErpSnapshotFilename(input, 'midday.xlsx');
    assert.equal(output[0].filename, 'midday.xlsx');
    assert.equal(output[1].values.filename, 'midday.xlsx');
    assert.equal(output[0].spec, 'saved');
    assert.deepEqual(output[1].values.photos, ['saved.jpg']);
    assert.equal(output[1].values.pick_note, 'keep');
    assert.deepEqual(output[1].rawFields, ['itemcode']);
    assert.equal(input[0].filename, 'old.xlsx');
    assert.equal(input[1].values.filename, 'old.xlsx');
    assert.throws(() => stampErpSnapshotFilename(input, ''), /ERP_SOURCE_FILENAME_REQUIRED/);
}

export function assertCheckedRunTime() {
    const sourceTime = '2026-11-10T17:15:01Z', finishedAt = '2026-11-11T12:49:45Z';
    const run = {runId:'test-run', active:false, status:'complete', finishedAt};
    const files = [{iso:sourceTime, ms:Date.parse(sourceTime)}];
    assert.equal(latestErpHomeTimestamp(files, run), finishedAt);
    assert.equal(confirmedErpRunTime({...run, active:true}), '');
    assert.equal(latestErpHomeTimestamp(files, {...run, error:'failed'}), sourceTime);
    assert.equal(latestErpHomeTimestamp(files, {...run, serverFinishedAt:''}), sourceTime);
}
