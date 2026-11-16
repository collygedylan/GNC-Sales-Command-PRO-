import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {replayCanonicalDeliveryCron} from '../services/canonical-delivery-cron-replay.mjs';

export function assertReclassInquiryTable(runFunctions,plain) {
  const context = runFunctions('Code.gs', ['buildReclassInlineOhText_', 'buildReclassItemInquiryTable_'], { sortReclassInquiryCompactRows_: rows => rows });
  const table = plain(context.buildReclassItemInquiryTable_({ identity: { commonname: 'Green Velvet Boxwood' }, rows: [{ unique_id: 'source', values: { lotcode: '27.S1', locationcode: 'A.03.000', source: 'BR', ptronhand: '275' }, actionValues: {}, changedFields: [] }], completedMoveSummary: [{ direction: 'move_up', quantity: 55, source: { unique_id: 'source' }, destination: { season: 'F1' } }] }));
  assert.deepEqual(table.columns.map(column => column[1]), ['Lotcode', 'Location', 'SOURCE', 'Priority', 'OH', 'PTRREVIEWED', 'Loc Note Date', 'LOCATIONPTN1', 'Location Note']);
  assert.equal(table.rows[0][4].text, '330 - 55 --> F1');
  assert.deepEqual(table.rows[0][4].proposals, []);
  assert.doesNotMatch(JSON.stringify(table.columns), /Action(?: Details)?/);
}

export function assertDeliveryCronReplay() {
  const root=path.resolve(import.meta.dirname,'../..');
  const name='20261112022023_agdata3078_delivery_cron_single_flight.sql';
  const source=readFileSync(path.join(root,'supabase/migrations',name),'utf8').replaceAll('\r\n','\n');
  const fixture=readFileSync(path.join(root,'supabase/ci/canonical_delivery_cron_identity.sql'),'utf8').replaceAll('\r\n','\n');
  const replay=replayCanonicalDeliveryCron(source,name,root);
  assert.equal(replayCanonicalDeliveryCron(source,'unrelated.sql',root),source);
  for(const invalid of [source.replace(/^begin;/i,''),source+'\ncommit;',source.replace('jobid=45','jobid=46')]) {
    assert.throws(()=>replayCanonicalDeliveryCron(invalid,name,root),/TRANSACTION_CHANGED/);
  }
  assert.equal(replay.slice(replay.indexOf(fixture)+fixture.length,replay.indexOf('do $cleanup$'))
    .replaceAll('jobid=(select jobid from pg_temp.ci_delivery_cron_identity where production_job_id=45)','jobid=45').trim(),
    source.replace(/^begin;\n/i,'').replace(/^commit;\s*$/im,'').trim());
  assert.ok(replay.indexOf('CANONICAL_DELIVERY_CRON_FIXTURE_ONLY')<replay.indexOf('do $schedule$'));
  assert.ok(replay.indexOf('do $cleanup$')>replay.indexOf('DELIVERY_CRON_UPDATE_UNCONFIRMED'));
  assert.match(replay,/perform cron\.unschedule\(\(select jobid from pg_temp\.ci_delivery_cron_identity\)\)/);
  assert.match(fixture,/production_job_id=45/);
}
