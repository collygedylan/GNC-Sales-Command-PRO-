import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Reproducible isolated PostgreSQL execution check for the additive migration.
// It uses the task's optional local PGlite installation and never connects to
// the configured Supabase project or any other external database.
const localRequire=createRequire(import.meta.url);
let PGlite;
try { ({PGlite}=localRequire(path.resolve('.gnc-local/pglite/node_modules/@electric-sql/pglite'))); }
catch { throw new Error('Install the local validation runtime at .gnc-local/pglite before running this harness.'); }

const fixture=`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private; create schema app_sync_private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.profiles(id uuid primary key,username text,role text,division text,display_name text,must_change_password boolean default false,disabled_at timestamptz,locked_until timestamptz);
create table private.app_access_runtime_state(singleton boolean primary key,enforcement_mode text);
create table private.app_access_policy_versions(id bigint primary key,version_number int,revision int);
create table private.app_limited_live_overrides(profile_id uuid,permission_key text,allowed boolean,decision_source text,primary key(profile_id,permission_key));
create table public.ph_eval_assignment_users(username text primary key,display_name text,active boolean);
create table public.app_dataset_revisions(key text primary key,state text,revision bigint);
create table public.ph_master_inventory(unique_id text primary key,itemcode text,genusname text,commonname text,contsize text,locationcode text,plantgroupcode text);
create table public.ph_warehouse_assigned_items(
 id bigint generated always as identity primary key,unique_id text,itemcode text,itemcode_normalized text,genusname text,genusname_normalized text,
 concat text,assignment_key text,commonname text,contsize text,locationcode text,source text,first_seen_at timestamptz,last_seen_at timestamptz,
 present_in_drive boolean default true,raw_row jsonb,updated_at timestamptz,assignedto text,assigned_by text,assigned_at timestamptz,
 unassigned_notified_at timestamptz);
create unique index assignment_key_fixture_unique on public.ph_warehouse_assigned_items(assignment_key) where assignment_key is not null;
create table public.ph_request_delivery_outbox(event_key text primary key,event_type text,payload jsonb,status text,next_attempt_at timestamptz,delivered_at timestamptz,sanitized_error_code text);
create table app_sync_private.import_runs(id uuid primary key,source_keys text[],canonical_keys text[],state text,expires_at timestamptz,finished_at timestamptz);
create table app_sync_private.import_leases(key text primary key,run_id uuid);
create function private.current_active_profile() returns public.profiles language sql stable as $$ select p.* from public.profiles p where p.id=auth.uid() $$;
create function private.can_manage_eval_assignments() returns boolean language sql stable as $$ select current_setting('app.test_can_manage',true)='true' $$;
create function private.normalize_eval_assignment_key(itemcode text,genusname text) returns text language sql immutable as $$
 select case when nullif(btrim(coalesce(itemcode,'')),'') is null then null else upper(btrim(itemcode))||'|'||lower(regexp_replace(btrim(coalesce(genusname,'')),'[[:space:]]+',' ','g')) end $$;
create function private.is_kayla_managed_role_v1(p_role text) returns boolean language sql immutable as $$ select p_role='SALESMARKETING' $$;
create function private.resolve_app_access_policy_id_v1(boolean default false) returns bigint language sql stable as $$ select 1::bigint $$;
create function private.get_effective_app_permissions_v1(uuid,bigint)
 returns table(permission_key text,permission_kind text,module_key text,label text,allowed boolean,access_scope text,decision_source text,sort_order int)
 language sql stable as $$ select 'live.permission'::text,'data'::text,'drive'::text,'Live permission'::text,false,'module'::text,'role'::text,1 $$;
create function public.get_my_app_permissions_v1() returns jsonb language sql as $$ select '{}'::jsonb $$;
create function app_sync_private.snapshot(text[]) returns jsonb language plpgsql as $$
declare actor uuid:=auth.uid(); actor_scope jsonb:='{}'; permissions jsonb:='[]'; version text;
begin version := md5(actor_scope::text||permissions::text); return jsonb_build_object('permissionVersion',version); end $$;
create function public.reconcile_eval_itemcodes() returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.set_eval_itemcode_assignment(itemcode text,genusname text,assignedto text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare normalized_code text:=upper(btrim(coalesce(itemcode,''))); resolved_genus text:=genusname; normalized_key text; result jsonb;
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'EVAL_ASSIGNMENT_FORBIDDEN';
  end if;
  normalized_key := private.normalize_eval_assignment_key(normalized_code, resolved_genus);
  update public.ph_warehouse_assigned_items set assignedto=set_eval_itemcode_assignment.assignedto where assignment_key=normalized_key returning to_jsonb(public.ph_warehouse_assigned_items.*) into result;
  return result;
end $$;
create function app_sync_private.advance_import(p_run_id uuid,p_action text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare run app_sync_private.import_runs; target text;
begin
  if p_action not in ('heartbeat','finish','fail') then raise exception 'DATASET_IMPORT_ACTION_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dataset-import:'||p_run_id::text,0));
  select * into run from app_sync_private.import_runs where id=p_run_id;
  if not found then raise exception using errcode='55000',message='DATASET_IMPORT_TOKEN_INVALID'; end if;
  target := case p_action when 'finish' then 'completed' when 'fail' then 'failed' else 'active' end;
  if run.state<>'active' then raise exception using errcode='55000',message='DATASET_IMPORT_ALREADY_CLOSED'; end if;
  if p_action<>'fail' and run.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='DATASET_IMPORT_EXPIRED'; end if;
  perform 1 from public.app_dataset_revisions where key=any(run.source_keys) order by key for update;
  if exists(select 1 from unnest(run.source_keys) requested(source_key) where not exists(select 1 from app_sync_private.import_leases l where l.key=requested.source_key and l.run_id=run.id)) then
    raise exception using errcode='55000',message='DATASET_IMPORT_FENCE_LOST';
  end if;
  if p_action='heartbeat' then
    update app_sync_private.import_runs set expires_at=clock_timestamp()+interval '12 minutes' where id=run.id;
  else
    update app_sync_private.import_runs set state=target,finished_at=clock_timestamp() where id=run.id;
    update public.app_dataset_revisions set state=case when p_action='finish' then 'ready' else 'interrupted' end,revision=revision+1 where key=any(run.source_keys);
    if p_action='finish' then delete from app_sync_private.import_leases where run_id=run.id; end if;
  end if;
  return jsonb_build_object('ok',true,'runId',run.id,'state',target);
end $$;
`;

const db=new PGlite();
const check=async(sql,params=[])=>db.query(sql,params);
let runNumber=0;
async function beginMasterRun({source=['ph_master_inventory'],canonical=['ph_master_inventory'],lease=true}={}) {
  const id=`a0300000-0000-4000-8000-${String(++runNumber).padStart(12,'0')}`;
  await check("update public.app_dataset_revisions set state='importing',revision=revision+1 where key='ph_master_inventory'");
  await check('insert into app_sync_private.import_runs values($1,$2,$3,$4,now()+interval \'10 minutes\',null)',[id,source,canonical,'active']);
  if(lease) await check('insert into app_sync_private.import_leases values($1,$2)',['ph_master_inventory',id]);
  return id;
}
async function finishMasterRun(id) {
  return (await check('select app_sync_private.advance_import($1,\'finish\') result',[id])).rows[0].result;
}
try {
  await db.exec(fixture);
  const migration=fs.readFileSync(path.resolve('supabase/migrations/20260929013125_perennial_zone_assignment_override.sql'),'utf8');
  await db.exec(migration);
  await db.exec(`insert into public.ph_eval_assignment_users values
      ('zoe_green','Zoe',true),('inactive_owner','Inactive owner',true),('dylan_collyge','Dylan',true),('megan_kelly','Megan',true);
    insert into public.profiles(id,username,role,division) values('00000000-0000-4000-8000-000000000001','dylan_collyge','SALESMARKETING','TEST');
    insert into private.app_access_runtime_state values(true,'enforced');
    insert into private.app_access_policy_versions values(1,1,1);
    insert into private.app_limited_live_overrides values('00000000-0000-4000-8000-000000000001','live.permission',true,'fixture');
    insert into public.app_dataset_revisions values('ph_master_inventory','ready',10);
    insert into public.ph_warehouse_assigned_items(unique_id,itemcode,itemcode_normalized,genusname,genusname_normalized,concat,assignment_key,
      assignedto,assigned_by,assigned_at,present_in_drive,source,raw_row)
      values
      ('fixture-assignment','00123','00123','Perennial','perennial','00123Perennial','00123|perennial','dylan_collyge','fixture',now(),true,'fixture','{}'),
      ('rose-assignment','00234','00234','Perennial','perennial','00234Perennial','00234|perennial','megan_kelly','fixture',now(),true,'fixture','{}'),
      ('inactive-assignment','00345','00345','Perennial','perennial','00345Perennial','00345|perennial','inactive_owner','fixture',now(),true,'fixture','{}'),
      ('exit-assignment','00678','00678','Perennial','perennial','00678Perennial','00678|perennial','megan_kelly','fixture',now(),true,'fixture','{}'),
      ('malformed-assignment','00456','00456','Perennial','perennial','00456Perennial','00456|perennial','megan_kelly','fixture',now(),true,'fixture','{}'),
      ('absent-assignment','00567','00567','Perennial','perennial','00567Perennial','00567|perennial','megan_kelly','fixture',now(),true,'fixture','{}');
    insert into public.ph_master_inventory values
      ('fixture-zone','00123','Perennial','fixture','1 gal','D.10.021','151_PEREN'),
      ('fixture-split','00123','Perennial','fixture','1 gal','A.01.001','151_PEREN'),
      ('rose-zone','00234','Perennial','rose fixture','1 gal','D.04.001','151_PEREN'),
      ('rose-exemption','00234','Perennial','rose fixture','1 gal','A.01.001','135_ROSES'),
      ('inactive-zone','00345','Perennial','inactive fixture','1 gal','C.06.001','151_PEREN'),
      ('exit-zone','00678','Perennial','exit fixture','1 gal','C.07','151_PEREN'),
      ('malformed-row','00456','Perennial','malformed fixture','1 gal','UNKNOWN','151_PEREN');`);
  const parserRows=(await check(`select private.eval_location_zone(location) zone from unnest(array[
    'C.06.001','C.07','D.04.999','D.09.001','D.10.021','D.10.022','D.03.001','D.10','UNKNOWN'
  ]) location`)).rows.map(row=>row.zone);
  const parserExpected=['inside','inside','inside','inside','inside','outside','outside',null,null];
  if(JSON.stringify(parserRows)!==JSON.stringify(parserExpected)) throw new Error(`Location parser boundaries differ: ${JSON.stringify(parserRows)}`);
  const {perennialPreviewSql}=await import('./preview-perennial-assignment.mjs');
  await check("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false)");
  const versions=(await check("select public.get_my_app_permissions_v1()->>'dataPermissionVersion' app, app_sync_private.snapshot(array[]::text[])->>'permissionVersion' dataset")).rows[0];
  if(versions.app!==versions.dataset) throw new Error('App permissions and dataset revisions returned different permission versions.');
  await check("update private.app_limited_live_overrides set allowed=false where profile_id='00000000-0000-4000-8000-000000000001'");
  const changedVersions=(await check("select public.get_my_app_permissions_v1()->>'dataPermissionVersion' app, app_sync_private.snapshot(array[]::text[])->>'permissionVersion' dataset")).rows[0];
  if(changedVersions.app!==changedVersions.dataset||changedVersions.app===versions.app) throw new Error('Limited live override did not change the canonical shared permission version.');
  const deferred=(await check('select public.reconcile_eval_itemcodes() result')).rows[0].result;
  if(deferred.errorCode!=='PERENNIAL_POLICY_AWAITING_MASTER_IMPORT') throw new Error('Scheduled reconciliation did not defer before the first complete snapshot.');
  let partialRun=await beginMasterRun({canonical:[]});
  const partialFinish=await finishMasterRun(partialRun);
  const partialActivation=(await check('select activated from private.ph_perennial_assignment_policy_state where singleton')).rows[0].activated;
  if(partialFinish.perennialAssignment!==undefined||partialActivation) throw new Error('A non-canonical import activated perennial assignment policy.');
  const firstRun=await beginMasterRun();
  const finalized=await finishMasterRun(firstRun);
  if(finalized.perennialAssignment?.status!=='completed'||finalized.perennialAssignment?.assignment_changes<1)
    throw new Error(`Import finalizer did not return the expected policy transition count: ${JSON.stringify(finalized)}`);
  const locked=(await check("select assignedto,zone_override_active,zone_override_prior_assignedto,zone_override_evaluated_revision,assignment_reason from public.ph_warehouse_assigned_items where assignment_key='00123|perennial'")).rows[0];
  if(locked.assignedto!=='zoe_green'||locked.zone_override_active!==true||locked.zone_override_prior_assignedto!=='dylan_collyge'
    ||Number(locked.zone_override_evaluated_revision)!==14||locked.assignment_reason!=='perennial_zone_area') throw new Error(`First import did not create the expected locked owner state: ${JSON.stringify(locked)}`);
  const preserved=(await check("select assignedto from public.ph_warehouse_assigned_items where assignment_key='00456|perennial'")).rows[0].assignedto;
  if(preserved!=='megan_kelly') throw new Error('An all-malformed location group changed its saved owner.');
  const preview=(await check(perennialPreviewSql)).rows[0];
  if(preview.preview_ready!==true||Number(preview.in_zone_policy_groups)!==3||!Array.isArray(preview.affected_assignments))
    throw new Error('Read-only preview failed against the installed local schema.');
  const absent=(await check("select assignedto from public.ph_warehouse_assigned_items where assignment_key='00567|perennial'")).rows[0].assignedto;
  if(absent!=='megan_kelly') throw new Error('An absent group changed its saved owner.');
  await check("update public.app_dataset_revisions set revision=revision+1 where key='ph_master_inventory'");
  await check('select public.reconcile_eval_itemcodes()');
  const revision=(await check("select zone_override_evaluated_revision from public.ph_warehouse_assigned_items where assignment_key='00123|perennial'")).rows[0].zone_override_evaluated_revision;
  if(revision!==15) throw new Error('A same-owner refresh did not store its evaluated revision.');
  const auditCount=(await check("select count(*)::int count from private.ph_warehouse_assignment_audit where assignment_key='00123|perennial' and event_type='zone_enforced'")).rows[0].count;
  if(auditCount!==1) throw new Error('Same-owner metadata refresh duplicated transition audit.');
  await check("select set_config('app.test_can_manage','false',false)");
  let denied=false;
  try { await check("select public.set_eval_itemcode_assignment('00456','Perennial','zoe_green')"); }
  catch(error) { denied=String(error.message).includes('EVAL_ASSIGNMENT_FORBIDDEN'); }
  if(!denied) throw new Error('Setter lost its manager authorization guard.');
  await check("select set_config('app.test_can_manage','true',false)");
  let lockedEdit=false;
  try { await check("select public.set_eval_itemcode_assignment('00123','Perennial','megan_kelly')"); }
  catch(error) { lockedEdit=String(error.message).includes('EVAL_ASSIGNMENT_ZONE_LOCKED'); }
  if(!lockedEdit) throw new Error('Manual assignment RPC allowed editing an active zone lock.');
  // The rose exemption restores the saved owner, while an inactive saved owner is cleared.
  let run=await beginMasterRun();
  await check("update public.ph_master_inventory set plantgroupcode='135_ROSES' where unique_id in ('fixture-zone','rose-zone','inactive-zone')");
  await check("update public.ph_eval_assignment_users set active=false where username='inactive_owner'");
  await finishMasterRun(run);
  const rose=(await check("select assignedto,zone_override_active,assignment_reason from public.ph_warehouse_assigned_items where assignment_key='00123|perennial'")).rows[0];
  if(rose.assignedto!=='dylan_collyge'||rose.zone_override_active||rose.assignment_reason!=='rose_exemption_restore') throw new Error(`Rose exemption did not restore its prior owner: ${JSON.stringify(rose)}`);
  const inactive=(await check("select assignedto,assignment_reason from public.ph_warehouse_assigned_items where assignment_key='00345|perennial'")).rows[0];
  if(inactive.assignedto!==null||inactive.assignment_reason!=='saved_owner_inactive_reset') throw new Error('Inactive prior owner was restored instead of cleared.');
  // Ordinary proven zone exit clears the owner; reentry enforces Zoe again.
  run=await beginMasterRun();
  await check("update public.ph_master_inventory set locationcode='A.01.001' where unique_id='exit-zone'");
  await finishMasterRun(run);
  let owner=(await check("select assignedto from public.ph_warehouse_assigned_items where assignment_key='00678|perennial'")).rows[0].assignedto;
  if(owner!==null) throw new Error('Completed outside snapshot did not clear the locked owner.');
  run=await beginMasterRun();
  await check("update public.ph_master_inventory set locationcode='D.05.001' where unique_id='exit-zone'");
  await finishMasterRun(run);
  owner=(await check("select assignedto from public.ph_warehouse_assigned_items where assignment_key='00678|perennial'")).rows[0].assignedto;
  if(owner!=='zoe_green') throw new Error('Reentry after a proven exit did not enforce Zoe.');
  // A lost lease aborts finish before any assignment action commits.
  run=await beginMasterRun({lease:false});
  await check("insert into public.ph_master_inventory values('failed-finish-row','00999','Perennial','failed','1 gal','C.06.001','151_PEREN')");
  let fenceRejected=false;
  try { await finishMasterRun(run); } catch(error) { fenceRejected=String(error.message).includes('DATASET_IMPORT_FENCE_LOST'); }
  if(!fenceRejected) throw new Error('A missing import lease did not reject finalization.');
  const failedRow=(await check("select count(*)::int n from public.ph_warehouse_assigned_items where assignment_key='00999|perennial'")).rows[0].n;
  if(failedRow!==0) throw new Error('A failed import fence committed assignment changes.');
  console.log('PGlite migration execution passed: parser boundaries, canonical atomic import, split/rose/malformed/absent handling, restore/exit/reentry, revision metadata, audit stability, permission hashing, and setter guards.');
} catch(error) {
  console.error(`PGlite migration validation failed: ${error.message}`);
  process.exitCode=1;
} finally { await db.close(); }
