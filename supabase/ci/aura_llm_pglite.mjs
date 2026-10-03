// Isolated behavior checks. No configured production connection is read.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrationContractQuery, auraLlmFreeTierMigrationName } from '../../scripts/apply-item-low-stock-migration.mjs';
const args=process.argv.slice(2);
const root=args[args.indexOf('--pglite-root')+1];
if(!args.includes('--pglite-root')||!root) throw Error('Pass --pglite-root');
const require=createRequire(path.join(path.resolve(root),'package.json'));
const { PGlite }=require('@electric-sql/pglite');
const db=new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.ph_app_settings(key text primary key,value jsonb);
    insert into public.ph_app_settings values('current_season_salesyear','{"seasonCode":"F1","salesYear":"27"}');
    create table public.ph_master_inventory(unique_id text primary key,itemcode text,commonname text,contsize text,
      locationcode text,lotcode text,ptravailable text,ptronhand text,s_lts text,priority text,season text,saleyear text,desigitem text,app_tab_assignment text);
    grant select on public.ph_app_settings,public.ph_master_inventory to service_role;`);
  for(const name of ['20261002121446_aura_inventory_v2_007.sql','20261003025749_aura_llm_free_tier_011.sql']) {
    await db.exec(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  }
  assert.equal((await db.query(migrationContractQuery(auraLlmFreeTierMigrationName))).rows[0].installed,true,'guarded release validates the installed security contract');
  const call=async (id=randomUUID(),round=1,tokens=100,rpm=15,tpm=1000000,rpd=1500) =>
    (await db.query('select public.aura_llm_reserve_call_v1($1,$2,$3,$4,$5,$6) data',[id,round,tokens,rpm,tpm,rpd])).rows[0].data;
  const clear=()=>db.exec('delete from aura_private.llm_provider_calls');
  await db.exec('set role service_role');
  const id=randomUUID();
  assert.equal((await call(id)).allowed,true);
  assert.equal((await call(id)).duplicate,true);
  assert.equal((await call(id,2)).allowed,true,'second model round consumes a separate reservation');
  for(let i=2;i<15;i++) assert.equal((await call()).allowed,true);
  const denied=await call();
  assert.equal(denied.reason,'rpm'); assert.ok(denied.retryAfter>0&&denied.retryAfter<=60);
  await clear();
  assert.equal((await call(randomUUID(),1,80,15,100)).allowed,true);
  assert.equal((await call(randomUUID(),1,21,15,100)).reason,'tpm');
  assert.equal((await call(randomUUID(),1,101,15,100)).reason,'input_limit');
  await db.exec("reset role; update aura_private.llm_provider_calls set created_at=clock_timestamp()-interval '61 seconds'; set role service_role;");
  assert.equal((await call(randomUUID(),1,80,15,100)).allowed,true,'rolling-minute tokens expire');
  await clear();
  assert.equal((await call(randomUUID(),1,100,15,1000000,1)).allowed,true);
  assert.equal((await call(randomUUID(),1,100,15,1000000,1)).reason,'rpd');
  await assert.rejects(call(randomUUID(),1,100,16),/AURA_LLM_QUOTA_INVALID/);
  await db.exec('reset role');
  await db.exec(`update aura_private.llm_provider_calls set created_at=clock_timestamp()-interval '3 days'; set role service_role;`);
  assert.equal((await call()).allowed,true,'old ledger records do not consume current windows');
  assert.equal((await db.query('select count(*)::int n from aura_private.llm_provider_calls')).rows[0].n,1,'pruning bounds the ledger');
  await db.exec('reset role');
  await db.exec(`insert into public.ph_master_inventory select 'lot-'||lpad(n::text,3,'0'),'GEM','Baby Gem','3DP','A.1','27.U1',
    '20','25','1','1','U1','27','','' from generate_series(1,103) n;
    insert into public.ph_master_inventory values('denied','GEM','Baby Gem','3DP','A.1','27.U1','20','25','1','1','U1','27','','not_on_inventory_denied'),
    ('future','GEM','Baby Gem','3DP','A.1','27.U1','20','25','1','1','U1','28','',''); set role service_role;`);
  const lot=async(cursor=null)=>(await db.query("select public.aura_inventory_lot_lookup_v1('27.u1',$1,100) data",[cursor])).rows[0].data;
  const first=await lot();
  assert.equal(first.rows.length,100); assert.equal(first.hasMore,true); assert.equal(first.complete,true);
  assert.equal(first.total,undefined,'a lot page never claims a complete total');
  const last=await lot(first.nextCursor); assert.equal(last.rows.length,3); assert.equal(last.hasMore,false);
  assert.equal(new Set([...first.rows,...last.rows].map(r=>r.unique_id)).size,103);
  await db.exec(`reset role; update public.ph_master_inventory set ptravailable='' where unique_id='lot-103'; set role service_role;`);
  assert.equal((await lot()).complete,false,'unknown metric outside the first page prevents complete assertions');
  const unknown=(await lot('lot-102')).rows[0]; assert.equal(unknown.ptravailable,null,'missing is not zero');
  await db.exec('reset role; set role authenticated');
  await assert.rejects(call(),/permission denied/);
  await assert.rejects(lot(),/permission denied/);
  await db.exec('reset role');
  const daylight=await db.query("select extract(epoch from (('2026-03-09'::timestamp at time zone 'America/Los_Angeles')-('2026-03-08'::timestamp at time zone 'America/Los_Angeles')))::int seconds");
  assert.equal(daylight.rows[0].seconds,23*3600,'daily reset follows Pacific midnight across daylight saving');
  console.log('AURA .011 quota, lot paging, missing data and permission checks passed.');
} finally { await db.close(); }
