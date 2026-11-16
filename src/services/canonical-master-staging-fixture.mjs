import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const HISTORICAL_MASTER_STAGING_FIXTURE='supabase/tests/master_snapshot_chunked_staging_v1_test.sql';
const fixtureDigest='00cb2e67ad2db102984f390207a442244b52acfa4bfc6dab07fa2b2b6a32022f';
const fixtureFunctions=Object.freeze({'retired-crop':'v2313_forged_marker_case','split-seed':'v2313_seed_split_rows',
  'split-receipt':'v2313_split_receipt','context-receipt':'v2313_context_receipt'});

function fragment(read,name) {
  const source=read('src/services/master-staging-fixtures/'+name+'.sql').replaceAll('\r\n','\n');
  assert.ok(source.includes('create or replace function pg_temp.'+fixtureFunctions[name]+'('),'missing canonical staging fixture helper');
  return source;
}

function replaceOnce(source,old,next) {
  assert.equal(source.split(old).length,2,'canonical staging fixture anchor drift');
  return source.replace(old,next);
}

function replaceSlice(source,start,end,replacement,offset=0) {
  const first=source.indexOf(start,offset),last=source.indexOf(end,first);
  assert.ok(first>=offset && last>first,'canonical staging fixture slice drift');
  return source.slice(0,first)+replacement+source.slice(last);
}

function extractSplitSetup(source) {
  const offset=source.indexOf('function pg_temp.v2313_genuine_split_case');
  source=replaceSlice(source,"  v_rows:='[]'::jsonb;",'  select jsonb_agg(to_jsonb(m) order by m.unique_id) into v_before',
    '  v_rows:=pg_temp.v2313_seed_split_rows(p_case,v_prefix);\n',offset);
  source=replaceOnce(source," v_rows jsonb;v_fields jsonb:='[\"desigcust\",\"desigitem\",\"desigloc\",\"locationnote\",\"locationptn1\",\"oversellpercentage\",\"pullerresponsibility\",\"salesnote\",\"suspend\"]';\n v_values jsonb;v_uid text;v_stable text;v_response jsonb;v_before jsonb;v_after jsonb;\n v_result jsonb;v_error text;v_state text;v_label text;",
    ' v_rows jsonb;v_response jsonb;v_before jsonb;v_after jsonb;\n v_result jsonb;v_error text;v_state text;');
  return replaceSlice(source,"  v_result:=jsonb_build_object('state'","  raise exception using errcode='ZC003'",
    '  v_result:=pg_temp.v2313_split_receipt(v_prefix,v_rows,v_before,v_after,v_response,v_state,v_error,v_run);\n',offset);
}

export function compileCanonicalMasterStagingFixture(original,read) {
  let source=original.replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(source).digest('hex'),fixtureDigest,
    'historical staging fixture changed; review its current-schema adaptation explicitly');
  const cropStart=source.indexOf('select ok((select p.prosecdef');
  const cropEnd=source.indexOf('-- Compare both publication APIs',cropStart);
  assert.ok(cropStart>0 && cropEnd>cropStart);
  source=source.slice(0,cropStart)+fragment(read,'retired-crop')+'\n\n'+source.slice(cropEnd);
  source=replaceSlice(source,"    if p_case='forged' then",'    else\n',
    "    if p_case='forged' then\n      result_value:=pg_temp.v2313_forged_marker_case();\n");
  source=replaceOnce(source,"  forged_uid text:='v2313-context-forged'; inserted_crop boolean; updated_crop boolean; deleted_crop boolean;\n",'');
  source=replaceSlice(source,'      result_value:=jsonb_build_object(',"      if p_case='new' then",
    '      result_value:=pg_temp.v2313_context_receipt(v_run,v_prefix,v_values,v_rows,v_fields,v_receipt);\n',
    source.indexOf('function pg_temp.v2313_reduced_context_case'));
  source=replaceOnce(source,'create or replace function pg_temp.v2313_reduced_context_case',
    fragment(read,'context-receipt')+'\ncreate or replace function pg_temp.v2313_reduced_context_case');
  source=extractSplitSetup(source);
  source=replaceOnce(source,'-- V2313_SPLIT_HELPER_BEGIN\n',
    '-- V2313_SPLIT_HELPER_BEGIN\n'+fragment(read,'split-seed')+'\n'+fragment(read,'split-receipt')+'\n');
  source=replaceOnce(source,'forged GUC is cleared and ordinary INSERT still publishes crop data',
    'forged GUC is cleared while ordinary INSERT retains crop retirement');
  source=replaceOnce(source,'forged GUC cannot suppress ordinary UPDATE crop synchronization',
    'forged GUC cannot revive retired crop synchronization during ordinary UPDATE');
  source=replaceOnce(source," and result#>>'{publishedRows,0,desigcust}'='APP-ABRN',\n 'staged publication preserves a pending exact-row designation alongside the new source UID')",
    " and result#>>'{publishedRows,0,desigcust}'='ABRN'\n and result#>>'{designationReceipt,uid}'='v2313-split-pending-a'\n and result#>>'{designationReceipt,status}'='discrepant'\n and (result#>>'{designationReceipt,absorbed}')::boolean\n and (result#>>'{designationReceipt,same_run}')::boolean\n and result#>>'{designationReceipt,app_value}'='APP-ABRN'\n and result#>>'{designationReceipt,erp_value}'='ABRN',\n 'changed ERP designation requires its exact lossless discrepancy receipt alongside the new source UID')");
  assert.equal(source.match(/\bselect (ok|is|throws_ok)\(/g).length,original.match(/\bselect (ok|is|throws_ok)\(/g).length,
    'canonical adaptation retains every historical assertion registration');
  return source;
}
