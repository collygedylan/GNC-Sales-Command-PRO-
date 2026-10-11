import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const args=process.argv.slice(2),dependencyRoot=args[args.indexOf('--pglite-root')+1];
if(!args.includes('--pglite-root')||!dependencyRoot)throw new Error('Pass --pglite-root');
const {PGlite}=createRequire(path.join(path.resolve(dependencyRoot),'package.json'))('@electric-sql/pglite');
const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema sales_private;
  create table public.profiles(id uuid primary key,username text,role text,disabled_at timestamptz,must_change_password boolean default false,locked_until timestamptz);
  create table sales_private.rep_identities(kind text,identity_key text,profile_id uuid);
  create function sales_private.key(value text) returns text language sql immutable as $$select lower(btrim(value))$$;
  insert into profiles(id,username,role) values('11111111-1111-4111-8111-111111111111','role_diagnostic',E'\\nREP\\r\\n');
  insert into sales_private.rep_identities values('external_id','02','11111111-1111-4111-8111-111111111111');`);
 const sql=fs.readFileSync('supabase/migrations/20261011224500_normalize_sales_actor_role_boundaries.sql','utf8');
 await db.exec(sql);
 const result=(await db.query(`select (sales_private.actor('11111111-1111-4111-8111-111111111111')).role as role,
  sales_private.request_mapping_rep_allowed_v1('11111111-1111-4111-8111-111111111111','02') as own,
  sales_private.request_mapping_rep_allowed_v1('11111111-1111-4111-8111-111111111111','03') as other`)).rows[0];
 assert.deepEqual(result,{role:'REP',own:true,other:false});
 assert.equal((await db.query('select role from profiles')).rows[0].role,'\nREP\r\n');
 await db.exec("update profiles set must_change_password=true");
 await assert.rejects(db.query("select sales_private.actor('11111111-1111-4111-8111-111111111111')"),/SALES_ACTOR_NOT_ACTIVE/);
 assert.equal((await db.query("select sales_private.request_mapping_rep_allowed_v1('11111111-1111-4111-8111-111111111111','02') as allowed")).rows[0].allowed,false);
 await db.exec(sql);
 console.log('Sales role boundaries: whitespace, exact leading-zero ownership, isolation, inactive actors, unchanged stored data passed.');
} finally {await db.close();}
