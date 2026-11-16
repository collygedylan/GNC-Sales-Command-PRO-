import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {readGeneratedDatabaseTypes,verifyGeneratedDatabaseTypes} from '../../scripts/database-type-parts.mjs';
import {databaseContracts,generateContracts} from '../../scripts/generate-database-contracts.mjs';
import {extractCurrentSchemaContracts,writeCurrentSchemaContractParts} from '../services/current-schema-contract-parts.mjs';

export function assertGeneratedActionSchema() {
  const root=path.resolve(import.meta.dirname,'../..');
  const native=readGeneratedDatabaseTypes(root);
  const action=native.split('      app_row_actions: {')[1]?.split('        Insert: {')[0];
  assert.ok(action,'canonical action ledger is included in generated public types');
  for(const field of ['app_update_action','app_update_row','rule_scope']) assert.match(action,new RegExp(field+': Json\\b'));
  assert.match(action,/canonical_unique_id: string/);
  assert.match(action,/changed_fields: string\[\]/);
  assert.match(action,/sync_run_id: string \| null/);
  const discrepancy=native.split('      ph_action_discrepancies: {')[1]?.split('        Insert: {')[0];
  assert.ok(discrepancy,'canonical discrepancy receipts are typed');
  assert.match(discrepancy,/source_file_name: string\n/);
  const sql=readFileSync(path.join(root,'supabase/migrations/20261111120000_agdata3070_action_discrepancies.sql'),'utf8');
  assert.match(sql,/create table public\.app_row_actions/);
  assert.match(sql,/source_file_name text not null/);
  verifyGeneratedDatabaseTypes(root,native);
  const stale=native.replace('      app_row_actions: {','      missing_action_ledger: {');
  assert.notEqual(stale,native);
  assert.throws(()=>verifyGeneratedDatabaseTypes(root,stale),/DATABASE_TYPES_OUT_OF_DATE/);
  generateContracts({root,check:true});
}

export function assertFocusedAvStartup(read,functionSource) {
  const resetSource = functionSource('assets/app-runtime.js', 'resetAVView');
  assert.match(resetSource, /preserveFocusedSearch = isViewVisible\('av'\) && document\.activeElement === searchInput/);
  assert.match(resetSource, /if \(!preserveFocusedSearch && searchInput\) searchInput\.value=""/);
  assert.match(read('.codex/skills/agdata-drive-and-av-specialist/SKILL.md'), /Never let a delayed AV view reset erase a focused search/);
}

export function assertLosslessCurrentSchemaParts() {
  const root=path.resolve(import.meta.dirname,'../..');
  const original=databaseContracts(readGeneratedDatabaseTypes(root));
  const remainder=structuredClone(original),selected=extractCurrentSchemaContracts(remainder);
  for(const kind of ['tables','functions','functionReturns']) {
    assert.deepEqual({...remainder[kind],...selected[kind]},original[kind]);
    assert.ok(Object.keys(selected[kind]).every(name=>!(name in remainder[kind])));
  }
  for(const [kind,name] of [['tables','app_row_actions'],['functions','manager_action_discrepancies_v3070']]) {
    const incomplete=structuredClone(original);
    delete incomplete[kind][name];
    const before=structuredClone(incomplete);
    assert.throws(()=>extractCurrentSchemaContracts(incomplete),/DATABASE_CURRENT_SCHEMA_CONTRACT_MISSING/);
    assert.deepEqual(incomplete,before,'a missing native symbol cannot partially consume the contract');
  }
  const written=[];
  const options={root,imports:'',header:'',check:true,format:JSON.stringify,
    write:(_root,file,content,check)=>written.push({file,content,check})};
  const wiring=writeCurrentSchemaContractParts({...options,contracts:structuredClone(original)});
  assert.equal(written.length,2);
  assert.ok(written.every(file=>file.check&&file.content.split('\n').length<=400));
  assert.match(wiring.imports,/current-schema-table-contracts/);
  assert.match(wiring.functionReturns,/currentSchemaReturns/);
  const before=written.length;
  assert.throws(()=>writeCurrentSchemaContractParts({...options,contracts:structuredClone(original),
    format:value=>JSON.stringify(value)+'\n'.repeat(401)}),/DATABASE_CURRENT_SCHEMA_CONTRACT_PART_TOO_LARGE/);
  assert.equal(written.length,before,'oversized output is rejected before any write');
}
