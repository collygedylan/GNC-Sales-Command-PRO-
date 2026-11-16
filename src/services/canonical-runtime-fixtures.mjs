import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {grantCanonicalFixtureAuthority} from './canonical-fixture-authority.mjs';
import {currentBulkContract} from './canonical-fixture-bulk.mjs';
import {currentRecipientContract,currentPhotoContract,currentFolderContract,currentSuspendContract,currentReclassDenials,
  currentReclassLedgerContract,currentSmartPublicContract,replaceFixtureText} from './canonical-fixture-contracts.mjs';

const fixtures=Object.freeze({
  application_conflict_http_status:['1d6f584652f39059133a848c721d2c55a78bb8664d1b67b8c4042ce64558bef5','request'],
  bulk_master_snapshot_v1:['12f8013bfde4b4ee1ab2d65bfa595c0fc18ae0b694d014d157d97c418e5939f3','bulk'],
  indexed_photo_evidence_lookup:['72bb9037b448cebbdb52a83c044332ba171398547aabad35c269bb3a623830bf','photo'],
  inventory_reclass_move_delivery_v1:['e3b14043e1393c11b633a92312f870457440a70de63e145c624a561ff1f9be94','recipient'],
  inventory_reclass_moves_v1:['96b2c0e14de75f426d0a49c841e0b9f20f489708f0aa6f750d1c1e517a102bba','reclass'],
  prompt25_editable_fields_v7:['90265038d46e94c67af81e0365db272fef30a6bf62e17e80354cf12bfc9a43a8','reclass'],
  reclass_server_revision:['a97b38bbd94e71ba814d43e425d8f69e79356942c7c94a77f9f053387ece8e72','reclass'],
  reclass_sheared_action_v5:['6c9bfb1976c399d92ec0e4746dd3a51e8830f4f90ce92cd14ec26e98608e2c7f','reclass'],
  request_queue_remove_v1:['0bf614f6a8e482ae9d3ae0e5a0d54c19a9d93b44f57c6eff9b06d6fb43347537','folder'],
  sales_rep_inventory_operations:['13ddfbe9ed6c27e36ba6347227b00c172a1ad8f5c2f786f3e8c323ad7e6689a0','rep'],
  smart_priority_hold_shield_v6:['a3321bb0afd4eb37bf65aaa87ef806c5da8689c61b29840b5666d6f01eaddbcc','reclass'],
  suspend_tag_close_contract:['71bf7b0c842531a95ca73c9aa735b577a042534b7b7fdf4794379b366c579050','suspend'],
  v2315_reclass_email_delivery:['f20be1d216f1952cfcd33fdbce1c8ca80b1d501376e186136a49ccaf32237e5e','recipient'],
  v2315_reclass_email_runtime:['3bacb04683093680e7cae83d905c2aa0030f60ecd0bc588901807e9309a03a40','reclass'],
});

function adaptFixture(source,mode,read) {
  if(['reclass','request','rep'].includes(mode)) {
    const template=read('src/services/canonical-runtime-fixtures/actor-matrix.sql');
    const result=grantCanonicalFixtureAuthority(source,template,mode);
    return mode==='rep'?replaceFixtureText(result,"'42501','SALES_REP_OPERATION_FORBIDDEN','Rep operation scope cannot authorize another source mode'",
      "'42501','DRIVE_RECLASS_FORBIDDEN','the explicit module matrix rejects another source mode before legacy operation scope'"):result;
  }
  if(mode==='bulk') return currentBulkContract(source,read);
  const transforms={photo:currentPhotoContract,folder:currentFolderContract,recipient:currentRecipientContract,suspend:currentSuspendContract};
  return transforms[mode](source);
}

export function compileCanonicalRuntimeFixture(file,original,read) {
  const name=/^supabase\/tests\/([^/]+)_test\.sql$/.exec(file)?.[1];
  const entry=fixtures[name];
  if(!entry) return original;
  const source=original.replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(source).digest('hex'),entry[0],'canonical fixture source changed: '+file);
  let result=currentReclassDenials(adaptFixture(source,entry[1],read),file);
  if(name==='inventory_reclass_moves_v1') result=currentReclassLedgerContract(result,read);
  if(name==='smart_priority_hold_shield_v6') result=currentSmartPublicContract(result);
  assert.deepEqual(result.match(/select\s+(?:plan\(\d+\)|no_plan\(\))/gi),source.match(/select\s+(?:plan\(\d+\)|no_plan\(\))/gi));
  assert.equal((result.match(/select\s+(?:ok|is|isnt|throws_ok|lives_ok|cmp_ok|has_function|has_table)\s*\(/gi)||[]).length,
    (source.match(/select\s+(?:ok|is|isnt|throws_ok|lives_ok|cmp_ok|has_function|has_table)\s*\(/gi)||[]).length,'canonical fixture assertion count changed');
  const guard="DO $fixture_guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM private.ci_schema_workspace_guard WHERE marker='canonical-baseline-replay') THEN RAISE EXCEPTION 'CANONICAL_RUNTIME_FIXTURE_REQUIRES_DISPOSABLE_SCHEMA'; END IF; END $fixture_guard$;";
  result=replaceFixtureText(result,'begin;','begin;\n'+guard);
  return result;
}
