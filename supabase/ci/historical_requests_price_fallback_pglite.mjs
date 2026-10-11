import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2), dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root');
const { PGlite } = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))('@electric-sql/pglite');
const db = new PGlite();
const rep = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; create schema sales_private;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table public.profiles(id uuid primary key,username text,display_name text,role text);
    create function sales_private.actor(uuid) returns public.profiles language sql as $$select p from public.profiles p where id=$1$$;
    create function sales_private.key(text) returns text language sql immutable as $$select lower(btrim($1))$$;
    create function sales_private.assigned_rep(jsonb) returns uuid language sql as $$select ($1->>'assigned_rep_id')::uuid$$;
    create function private.navigation_module_allowed_v1(uuid,text) returns boolean language sql as $$select true$$;
    create table public.app_dataset_revisions(key text primary key,revision bigint,state text);
    insert into public.app_dataset_revisions values ('ph_active_request',1,'ready'),('ph_request_history',1,'ready'),('ph_master_inventory',1,'ready');
    create table public.ph_master_inventory(unique_id text primary key,itemcode text,contsize text,locationcode text,lotcode text,listprice text);
    create table public.ph_request_history(unique_id text primary key,assigned_rep_id uuid,customername text,req_customer text,request_customer text,
      consigneename text,customeridentityid text,consigneeidentityid text,itemcode text,commonname text,contsize text,locationcode text,lotcode text,
      req_qty text,req_status text,created_at timestamptz,master_id text,master_unique_id text,snapshot jsonb default '{}');
    create table public.ph_active_request(like public.ph_request_history including all);`);
  const original = fs.readFileSync('supabase/migrations/20261010165013_historical_requests_financial_dashboard.sql','utf8');
  const number = original.slice(original.indexOf('create or replace function private.historical_requests_number_v1'),original.indexOf('create or replace function public.historical_requests_read_v1'));
  await db.exec(number);
  const migration = fs.readFileSync('supabase/migrations/20261011193000_historical_requests_price_fallback.sql','utf8');
  await db.exec(migration);
  await db.query('insert into public.profiles values ($1,$2,$3,$4),($5,$6,$7,$8)',[rep,'rep_one','Rep One','REP',other,'rep_two','Rep Two','REP']);
  const masters = [
    ['exact','000001','#1','E.1','L.1','$7'],
    ['single','000002','#3','E.2','L.2','10'],
    ['same-a','000003','#3','E.3','L.3','12.50'],['same-b','000003','#3','E.3','L.3','$12.50'],
    ['different-a','000004','#3','E.4','L.4','10'],['different-b','000004','#3','E.4','L.4','11'],
    ['invalid-a','000005','#3','E.5','L.5','10'],['invalid-b','000005','#3','E.5','L.5','bad'],
    ['null-a','000006','#3','E.6','L.6','10'],['null-b','000006','#3','E.6','L.6',null],
    ['negative','000007','#3','E.7','L.7','-2'],
    ['zero-a','000008','#3','E.8','L.8','0'],['zero-b','000008','#3','E.8','L.8','$0.00'],
    ['leading-zero-shadow','2','#3','E.2','L.2','999'],
    ['exact-invalid','000099','#3','E.99','L.99','bad'],
  ];
  for (const row of masters) await db.query('insert into public.ph_master_inventory values ($1,$2,$3,$4,$5,$6)',row);
  const requests = [
    ['exact-precedence','exact','000002','#3','E.2','L.2','2'],
    ['unique','obsolete','000002','#3','E.2','L.2','3'],
    ['same-price','obsolete','000003','#3','E.3','L.3','0'],
    ['conflicting','obsolete','000004','#3','E.4','L.4','1'],
    ['mixed-invalid','obsolete','000005','#3','E.5','L.5','1'],
    ['mixed-null','obsolete','000006','#3','E.6','L.6','1'],
    ['negative-price','obsolete','000007','#3','E.7','L.7','1'],
    ['zero-price','obsolete','000008','#3','E.8','L.8','1'],
    ['negative-six','obsolete','000002','#3','E.2','L.2','-6'],
    ['invalid-quantity','obsolete','000002','#3','E.2','L.2','bad'],
    ['invalid-exact-price','exact-invalid','000002','#3','E.2','L.2','1'],
    ['wrong-size','obsolete','000002','#5','E.2','L.2','1'],
    ['wrong-location','obsolete','000002','#3','E.99','L.2','1'],
    ['wrong-lot','obsolete','000002','#3','E.2','L.99','1'],
    ['incomplete','obsolete','000002',null,'E.2','L.2','1'],
    ['snapshot','obsolete',null,null,null,null,'1'],
    ['no-saved-id',null,'000002','#3','E.2','L.2','1'],
  ];
  for (const [id,masterId,item,size,location,lot,quantity] of requests) {
    const snapshot = id === 'snapshot' ? {itemcode:'000002',contsize:'#3',locationcode:'E.2',lotcode:'L.2'} : {};
    await db.query(`insert into public.ph_request_history(unique_id,assigned_rep_id,customername,consigneename,customeridentityid,consigneeidentityid,
      itemcode,contsize,locationcode,lotcode,req_qty,master_id,snapshot) values($1,$2,'Customer','Consignee','001','002',$3,$4,$5,$6,$7,$8,$9)`,
    [id,rep,item,size,location,lot,quantity,masterId,JSON.stringify(snapshot)]);
  }
  await db.query(`insert into public.ph_active_request(unique_id,assigned_rep_id,customername,consigneename,customeridentityid,consigneeidentityid,
    itemcode,contsize,locationcode,lotcode,req_qty,master_id) values('active-fallback',$1,'Customer','Consignee','001','002','000002','#3','E.2','L.2','2','obsolete'),
    ('another-rep',$2,'Other','Other','003','004','000002','#3','E.2','L.2','100','obsolete')`,[rep,other]);
  await db.query("select set_config('test.actor',$1,false)",[rep]);
  const query = {operation:'requests',customerKey:'customer:id:'+ (await db.query("select md5('001') key")).rows[0].key};
  query.consigneeKey = query.customerKey+'|consignee:id:'+(await db.query("select md5('002') key")).rows[0].key;
  query.pageSize = 100;
  const before = (await db.query('select to_jsonb(h) data from public.ph_request_history h order by unique_id')).rows;
  const data = (await db.query('select public.historical_requests_read_v1($1::jsonb) data',[JSON.stringify(query)])).rows[0].data;
  const rows = new Map(data.rows.map(row => [row.id,row]));
  assert.equal(data.total, requests.length + 1);
  assert.equal(rows.get('exact-precedence').totalValue,14);
  assert.equal(rows.get('unique').totalValue,30);
  assert.equal(rows.get('same-price').totalValue,312.5);
  assert.equal(rows.get('snapshot').totalValue,10);
  assert.equal(rows.get('no-saved-id').totalValue,10);
  assert.equal(rows.get('active-fallback').totalValue,20);
  assert.equal(rows.get('zero-price').totalValue,0);
  for (const id of ['conflicting','mixed-invalid','mixed-null','negative-price','negative-six','invalid-quantity','invalid-exact-price','wrong-size','wrong-location','wrong-lot','incomplete']) {
    assert.equal(rows.get(id).totalValue,null,id);
    assert.ok(rows.get(id).unresolvedReason,id);
  }
  assert.equal(rows.get('negative-six').effectiveQty,null);
  assert.equal(data.summary.totalValue,396.5);
  assert.equal(data.summary.unpricedCount,11);
  assert.equal(data.scope,'own');
  assert.equal(rows.has('another-rep'),false);
  assert.deepEqual((await db.query('select to_jsonb(h) data from public.ph_request_history h order by unique_id')).rows,before);
  await db.exec(migration);
  assert.deepEqual((await db.query('select public.historical_requests_read_v1($1::jsonb) data',[JSON.stringify(query)])).rows[0].data.summary,data.summary);
  const grants = (await db.query("select has_function_privilege('authenticated','public.historical_requests_read_v1(jsonb)','execute') signed_in,has_function_privilege('anon','public.historical_requests_read_v1(jsonb)','execute') anonymous,has_function_privilege('service_role','public.historical_requests_read_v1(jsonb)','execute') service")).rows[0];
  assert.deepEqual(grants,{signed_in:true,anonymous:false,service:false});
  console.log('Historical pricing fallback, strict tuple identity, ambiguity, quantities, isolation, grants, and read-only behavior passed.');
} finally { await db.close(); }
