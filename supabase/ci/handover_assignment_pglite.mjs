// Isolated execution of the actual assignment migration. Never connects remotely.
// node supabase/ci/handover_assignment_pglite.mjs --pglite-root .gnc-local/pglite
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw Error('Pass --pglite-root');
const { PGlite } = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))('@electric-sql/pglite');
const db = new PGlite();
const transition = 'kayla_knepp_to_nelly_aguilar_20261002';
const kayla = 'e2584b32-472c-4888-b592-394235050b5b';
const nelly = '961b0a0f-11a6-4db5-b066-582f772ab8e7';
const query = async sql => (await db.query(sql)).rows;
const ciFixture = fs.readFileSync(new URL('./scheduled_handover_fixture.sql', import.meta.url), 'utf8');
const evalRuleSchema = ciFixture.match(/CREATE TABLE IF NOT EXISTS public\.ph_eval_assignment_rules \([\s\S]*?\n\);/)[0];
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema private; create schema auth; create schema bunch_note_private;
    create table bunch_note_private.jobs(id uuid primary key,status text,owner_id uuid,revision integer default 1,updated_at timestamptz);
    create table ph_master_inventory_user_assignments(master_unique_id text,assignedto text,assignment_source text,source_assignedto text,itemcode text,lotcode text,locationcode text,source text,created_at timestamptz,updated_at timestamptz,primary key(master_unique_id,assignedto,assignment_source));
    create table profiles(id uuid primary key,username text,display_name text,disabled_at timestamptz,locked_until timestamptz);
    create table auth.users(id uuid primary key,email text);
    create table private.scheduled_account_handover_v1(transition_key text primary key,effective_at timestamptz,departing_profile_id uuid,successor_profile_id uuid);
    create table private.scheduled_account_handover_audit_v1(transition_key text,event_key text unique,event_type text,metadata jsonb);
    insert into private.scheduled_account_handover_v1 values('${transition}',now()+interval '1 day','${kayla}','${nelly}');
    insert into profiles(id,username,display_name) values('${nelly}','nelly_aguilar','Nelly Aguilar');
    insert into auth.users values('${nelly}','nelly_aguilar@greenleafnursery.com');
    ${evalRuleSchema}
    create table ph_warehouse_assigned_items(id bigint primary key,assignedto text,present_in_drive boolean);
    create table ph_inventory_edit_requests(id bigint primary key,assignedto text,status text,inventory_edit_completed_at timestamptz,photo_data_completed_at timestamptz);
    create table ph_master_inventory(unique_id text primary key,assignedto text,flyer_assigned text,date_completed timestamptz,eval_task_completed_at timestamptz,flyer_completed timestamptz);
    create table ph_reserves(unique_id text primary key,assignedto text,assigned_to text,flyer_assigned text,date_completed text,flyer_completed text);
    create table ph_soc_master(unique_id text primary key,assignedto text,flyer_assigned text,date_completed timestamptz,flyer_completed text);
    create table ph_location_work_jobs(id uuid primary key,status text,assigned_usernames text[],revision integer default 1,updated_at timestamptz);
    create table ph_location_work_assignments(id uuid default gen_random_uuid(),job_id uuid,profile_id uuid,username text,display_name text,email text,unique(job_id,profile_id),unique(job_id,username));
    create table ph_shear_location_inquiries(id uuid primary key,status text,recipient_profiles jsonb,recipient_usernames text[],recipient_emails text[],revision integer default 1,updated_at timestamptz);
  `);
  await db.exec(fs.readFileSync(new URL('../migrations/20261001222228_handover_assignment_transfer_005.sql', import.meta.url),'utf8'));
  const cases = [
    ['kayla_knepp','nelly_aguilar'], ['Kayla Knepp, dylan_collyge','nelly_aguilar, dylan_collyge'],
    ['kayla_knepp@greenleafnursery.com','nelly_aguilar@greenleafnursery.com'],
    ['kayla_knepp@other.example','kayla_knepp@other.example'], ['xkayla_knepp','xkayla_knepp'],
    ['kayla_knepp_jr','kayla_knepp_jr'], ['dylan_collyge','dylan_collyge'], [null,null],
  ];
  for (const [input,output] of cases) {
    const {rows} = await db.query('select private.handover_replace_identity_v1($1) value',[input]);
    assert.equal(rows[0].value,output);
  }
  await db.exec(`
    insert into ph_eval_assignment_rules(id,sheet_row_number,assignedto,active) values(1,1,'kayla_knepp, dylan_collyge',true),(2,2,'kayla_knepp',false);
    insert into ph_master_inventory values('open','Kayla Knepp','kayla_knepp',null,null,null),('done','kayla_knepp','kayla_knepp',now(),now(),now());
    insert into ph_reserves values('open','kayla_knepp','kayla_knepp',null,'',null),('done','kayla_knepp','kayla_knepp',null,'2026-09-30',null);
    insert into ph_master_inventory_user_assignments(master_unique_id,assignedto,assignment_source,source_assignedto)
      values('open','kayla_knepp','assignedto_final','Kayla Knepp'),('done','kayla_knepp','assignedto_final','Kayla Knepp');
    insert into bunch_note_private.jobs(id,status,owner_id)
      values('00000000-0000-0000-0000-000000000003','open','${kayla}'),('00000000-0000-0000-0000-000000000004','complete','${kayla}');
    insert into ph_location_work_jobs(id,status,assigned_usernames) values('00000000-0000-0000-0000-000000000001','open',array['kayla_knepp','nelly_aguilar','dylan_collyge']);
    insert into ph_location_work_assignments(job_id,profile_id,username) values('00000000-0000-0000-0000-000000000001','${kayla}','kayla_knepp');
    insert into ph_shear_location_inquiries(id,status,recipient_profiles,recipient_usernames,recipient_emails)
    values('00000000-0000-0000-0000-000000000002','open','[{"profileId":"${kayla}","username":"kayla_knepp","email":"kayla_knepp@greenleafnursery.com"},{"profileId":"${nelly}","username":"nelly_aguilar","email":"nelly_aguilar@greenleafnursery.com"},{"username":"dylan_collyge","email":"dylan_collyge@greenleafnursery.com"}]',array['kayla_knepp','nelly_aguilar','dylan_collyge'],array['kayla_knepp@greenleafnursery.com','nelly_aguilar@greenleafnursery.com','dylan_collyge@greenleafnursery.com']);
  `);
  const run = async (limit=100) => (await query(`select private.transfer_remaining_handover_assignments_v1('${transition}',${limit}) result`))[0].result;
  assert.equal((await run()).due,false);
  assert.equal((await query('select assignedto from ph_eval_assignment_rules where id=1'))[0].assignedto,'kayla_knepp, dylan_collyge');
  await db.exec(`update private.scheduled_account_handover_v1 set effective_at=now()-interval '1 second'`);
  let result = await run(1);
  assert.equal(result.changed,1); assert.equal(result.remaining,true);
  for(let i=0;i<20 && result.remaining;i++) result=await run(1);
  assert.equal(result.remaining,false);
  assert.equal((await run()).changed,0);
  assert.equal((await query('select assignedto from ph_eval_assignment_rules where id=1'))[0].assignedto,'nelly_aguilar, dylan_collyge');
  assert.equal((await query('select assignedto from ph_eval_assignment_rules where id=2'))[0].assignedto,'kayla_knepp');
  assert.equal((await query("select assignedto from ph_master_inventory where unique_id='done'"))[0].assignedto,'kayla_knepp');
  assert.equal((await query("select flyer_assigned from ph_master_inventory where unique_id='done'"))[0].flyer_assigned,'kayla_knepp');
  assert.equal((await query("select assigned_to from ph_reserves where unique_id='done'"))[0].assigned_to,'kayla_knepp');
  assert.equal((await query("select assigned_to from ph_reserves where unique_id='open'"))[0].assigned_to,'nelly_aguilar');
  assert.equal((await query("select assignedto from ph_master_inventory_user_assignments where master_unique_id='open'"))[0].assignedto,'nelly_aguilar');
  assert.equal((await query("select source_assignedto from ph_master_inventory_user_assignments where master_unique_id='open'"))[0].source_assignedto,'Kayla Knepp');
  assert.equal((await query("select assignedto from ph_master_inventory_user_assignments where master_unique_id='done'"))[0].assignedto,'kayla_knepp');
  assert.equal((await query("select owner_id from bunch_note_private.jobs where status='open'"))[0].owner_id,nelly);
  assert.equal((await query("select owner_id from bunch_note_private.jobs where status='complete'"))[0].owner_id,kayla);
  assert.deepEqual((await query('select assigned_usernames from ph_location_work_jobs'))[0].assigned_usernames,['dylan_collyge','nelly_aguilar']);
  assert.equal((await query('select username from ph_location_work_assignments'))[0].username,'nelly_aguilar');
  const shear=(await query('select recipient_profiles,recipient_usernames,recipient_emails from ph_shear_location_inquiries'))[0];
  assert.equal(shear.recipient_profiles[0].profileId,nelly);
  assert.equal(shear.recipient_profiles.some(profile=>profile.profileId===kayla),false);
  assert.deepEqual(shear.recipient_usernames,['nelly_aguilar','dylan_collyge']);
  assert.deepEqual(shear.recipient_emails,['nelly_aguilar@greenleafnursery.com','dylan_collyge@greenleafnursery.com']);
  await db.exec("insert into ph_eval_assignment_rules(id,sheet_row_number,assignedto,active) values(3,3,'kayla_knepp',true)");
  assert.equal((await query('select assignedto from ph_eval_assignment_rules where id=3'))[0].assignedto,'nelly_aguilar');
  assert.equal((await query("select count(*)::int n from private.scheduled_account_handover_audit_v1 where metadata->>'table'='ph_master_inventory' and metadata->>'id'='done'"))[0].n,0);
  console.log('Assignment SQL passed: exact identities, cutoff, bounded resume, idempotency, completed history, co-assignees, location and shear routing, future rules.');
} finally { await db.close(); }
