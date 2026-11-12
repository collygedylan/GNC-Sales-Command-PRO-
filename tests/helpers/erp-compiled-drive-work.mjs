import assert from 'node:assert/strict';
import { readErpStagePublication } from '../../supabase/functions/_shared/erp-publication-recovery.mjs';

export function assertCompiledDriveWorkSql(sql) {
  const batch = sql.match(/as \$batch\$([\s\S]*?)end \$batch\$/i)?.[1] || '';
  const prepare = sql.match(/as \$prep\$([\s\S]*?)end \$prep\$/i)?.[1] || '';
  const load = sql.match(/as \$load\$([\s\S]*?)end \$load\$/i)?.[1] || '';
  assert.match(batch, /p_after-p_before>250/);
  assert.match(batch, /unnest\(array\[r\.erp_row\]\) expanded\s+where r\.stage_id=p_stage and r\.row_number>p_before and r\.row_number<=p_after/i);
  assert.match(prepare, /next_row:=least\(w\.compiled_rows\+250,w\.expected_rows\)/);
  assert.match(prepare, /for update nowait/i);
  assert.match(prepare, /update private\.erp_drive_compiled_headers_v3078 set compiled_rows=next_row/i);
  assert.match(prepare, /analyze private\.erp_drive_compiled_rows_v3078 \(stage_id,row_number,unique_id,lineage_key,erp_work_cohort\)/i);
  assert.match(load, /perform private\.assert_drive_typed_checkpoint_v3077\(p_stage\)/i);
  assert.match(load, /h\.ready and not h\.dirty and h\.compiled_rows=h\.expected_rows/i);
  assert.match(load, /security_invoker=true[\s\S]+with local check option/i);
  assert.doesNotMatch(load, /\banalyze\b|\(erp_row\)\.\*|create temp table ph_master_bulk_stage_v1/i);
}

export async function assertCompiledDrivePublicationClock() {
  const began = Date.now() - 300000;
  let state = { stageId: 'compiled-stage', phase: 'finalize', expectedRows: 9610,
    processedRows: 9610, publicationPreparedRows: 9610, publicationProgressAt: began };
  let progressAt = began;
  const calls = [];
  const rpc = async (_client, name, args) => {
    assert.equal(args.p_stage_id, state.stageId);
    calls.push(name);
    return { data: { busy: true, ok: true, recoveryAccepted: name === 'resume_erp_stage_publication_v3077',
      preparedRows: 9610, typedPreparedRows: 9610,
      stage_id: state.stageId, publicationProgressAt: progressAt } };
  };
  for (let tick = 0; tick < 40; tick += 1) {
    progressAt += 5000;
    const result = await readErpStagePublication({}, state, rpc, progressAt + 1000);
    state = result.state;
    assert.equal(result.data.busy, true);
    assert.equal(state.publicationProgressAt, progressAt);
    assert.equal(state.publicationRecoveryAttempted, undefined);
  }
  assert.equal(calls.length, 40);
  const stalled = await readErpStagePublication({}, state, rpc, progressAt + 91000);
  assert.equal(stalled.state.publicationRecoveryAttempted, true);
  assert.equal(calls.filter(name => name === 'resume_erp_stage_publication_v3077').length, 1);
}
