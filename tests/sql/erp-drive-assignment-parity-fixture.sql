-- Capture the installed legacy resolver before loading the migration, then
-- run this fixture and roll back. All resolver/write inputs are synthetic.
select set_config('request.jwt.claim.role','service_role',true);
select set_config('agdata.bulk_import.ph_master_inventory','on',true);
insert into public.ph_master_inventory(unique_id,itemcode,genusname,commonname,contsize,locationcode,lotcode,plantgroupcode,source)
values
 ('erp-assignment-explicit','ERP3047-EXPLICIT','Fixture','Explicit','#2','D.04.001','28.F1','135_ROSES','PH'),
 ('erp-assignment-rose','ERP3047-ROSE','Fixture','Rose','#2','D.04.002','28.F1','135_ROSES','PH'),
 ('erp-assignment-zone','ERP3047-ZONE','Fixture','Zone','#2','C.06.002','28.F1','OTHER','PH'),
 ('erp-assignment-prior','ERP3047-PRIOR','Fixture','Prior','#2','D.10','28.F1','OTHER','PH'),
 ('erp-assignment-warehouse','ERP3047-LEGACY','Fixture','Warehouse','#2','D.10','28.F1','OTHER','PH'),
 ('erp-assignment-new','ERP3047-NEW','Fixture','New','#2','X.91.007','28.F1','OTHER','PH');
select set_config('agdata.bulk_import.ph_master_inventory','off',true);
create temporary table assignment_fixture_source as
select * from public.ph_master_inventory where unique_id like 'erp-assignment-%';
insert into public.ph_eval_assignment_users(username,display_name,active)
values ('mitch_kaiser','Mitch',true),('zoe_green','Zoe',true),('erp_assignment_prior','Prior Owner',true),
  ('erp_assignment_legacy','Legacy Owner',true),('erp_assignment_manual','Manual Owner',true)
on conflict(username) do update set active=true;
update public.profiles set disabled_at=null,locked_until=null where username in ('mitch_kaiser','zoe_green');
update private.ph_inventory_row_assignment_policy_state set active=false where singleton;
insert into public.ph_warehouse_assigned_items(unique_id,itemcode,itemcode_normalized,genusname,assignment_key,assignedto,assigned_at)
select 'warehouse-'||m.unique_id,m.itemcode,m.itemcode,m.genusname,
  private.normalize_eval_assignment_key(m.itemcode,m.genusname),
  case when m.unique_id='erp-assignment-warehouse' then 'erp_assignment_legacy' end,'2026-11-05T14:00:00Z'
from assignment_fixture_source m where unique_id not in ('erp-assignment-new','erp-assignment-explicit');
insert into public.ph_itemcode_default_owners(itemcode_normalized,assignedto,assigned_at,revision,updated_by)
values ('ERP3047-EXPLICIT','erp_assignment_manual','2026-11-06T14:00:00Z',2,'fixture-supervisor');
create temporary table assignment_fixture_default_attempts (code text);
create function pg_temp.record_assignment_fixture_default()
returns trigger language plpgsql as $probe$
begin
  insert into pg_temp.assignment_fixture_default_attempts values(new.itemcode_normalized);
  return new;
end
$probe$;
create trigger aaa_assignment_fixture_default_attempt before insert on public.ph_itemcode_default_owners
for each row execute function pg_temp.record_assignment_fixture_default();
insert into public.ph_inventory_row_assignments(master_unique_id,unique_id,assignedto,assigned_at,assignment_reason)
values ('erp-assignment-prior','erp-assignment-prior','erp_assignment_prior','2026-11-05T13:00:00Z','unresolved_preserved'),
  ('erp-assignment-removed','erp-assignment-removed','erp_assignment_prior','2026-11-05T13:00:00Z','unresolved_preserved');

do $scope$
declare
  definition text := pg_get_functiondef('private.plan_drive_row_assignments_v3047(bigint)'::regprocedure);
begin
  execute replace(definition,'from public.ph_master_inventory','from pg_temp.assignment_fixture_source');
  definition:=pg_get_functiondef('private.reconcile_drive_row_assignments_v3047(uuid)'::regprocedure);
  definition:=replace(definition,'from public.ph_master_inventory','from pg_temp.assignment_fixture_source');
  execute replace(definition,'where a.present_in_drive and not exists',
    'where a.master_unique_id like ''erp-assignment-%'' and a.present_in_drive and not exists');
  definition:=pg_get_functiondef('private.sync_new_unassigned_warehouse_itemcodes_v1(uuid)'::regprocedure);
  execute replace(definition,'from public.ph_master_inventory','from pg_temp.assignment_fixture_source');
end
$scope$;

do $test$
declare
  run_key uuid := 'a3047000-0000-4000-8000-000000000001';
  source_rev bigint;
  uid text;
  expected jsonb := '{}'::jsonb;
  observed jsonb;
  result jsonb;
begin
  result:=public.begin_dataset_import_v1(array['ph_master_inventory'],run_key,array['ph_master_inventory']);
  if result->>'state' is distinct from 'active' then raise exception 'ERP_ASSIGNMENT_FIXTURE_RUN_FENCE: %',result; end if;
  select revision+1 into source_rev from public.app_dataset_revisions where key='ph_master_inventory';
  perform private.sync_new_unassigned_warehouse_itemcodes_v1(run_key);
  begin
    for uid in select unique_id from assignment_fixture_source order by unique_id loop
      expected:=expected||jsonb_build_object(uid,to_jsonb(private.erp_fixture_legacy_assignment(uid,source_rev)));
    end loop;
    raise exception 'rollback legacy comparison' using errcode='P3407';
  exception when sqlstate 'P3407' then
    null;
  end;
  perform set_config('agdata.erp.drive_assignment_run_v3047',run_key::text,true);
  result:=public.finish_dataset_import_with_sources_v1(run_key,
    '[{"key":"ph_master_inventory","fileName":"erp-3047-fixture.xlsx","fileId":"erp-3047-fixture"}]');
  if not exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.locktype='advisory'
      and l.mode='ExclusiveLock' and l.granted and l.objsubid=1
      and l.classid::bigint=((hashtextextended('gnc-reconcile-eval-itemcodes-v2',0)>>32) & 4294967295)
      and l.objid::bigint=(hashtextextended('gnc-reconcile-eval-itemcodes-v2',0) & 4294967295))
    or exists(select 1 from pg_locks l join assignment_fixture_source s
      on l.classid::bigint=((hashtextextended('inventory-row-assignment:'||s.unique_id,0)>>32) & 4294967295)
      and l.objid::bigint=(hashtextextended('inventory-row-assignment:'||s.unique_id,0) & 4294967295)
      where l.pid=pg_backend_pid() and l.locktype='advisory' and l.granted and l.objsubid=1) then
    raise exception 'ERP_ASSIGNMENT_FIXTURE_UNBOUNDED_OR_UNFENCED_LOCKS';
  end if;
  select jsonb_object_agg(a.master_unique_id,to_jsonb(a)) into observed from public.ph_inventory_row_assignments a
  join assignment_fixture_source m on m.unique_id=a.master_unique_id;
  if observed is distinct from expected then
    raise exception 'ERP_ASSIGNMENT_FIXTURE_POLICY_MISMATCH expected=% observed=%',expected,observed;
  end if;
  if observed->'erp-assignment-explicit'->>'assignedto' is distinct from 'erp_assignment_manual'
    or observed->'erp-assignment-rose'->>'assignedto' is distinct from 'mitch_kaiser'
    or observed->'erp-assignment-zone'->>'assignedto' is distinct from 'zoe_green'
    or observed->'erp-assignment-prior'->>'assignedto' is distinct from 'erp_assignment_prior'
    or observed->'erp-assignment-warehouse'->>'assignedto' is distinct from 'erp_assignment_legacy'
    or observed->'erp-assignment-new'->>'assignment_reason' is distinct from 'unassigned' then
    raise exception 'ERP_ASSIGNMENT_FIXTURE_ROLE_COHORT: %',observed;
  end if;
  if result->'perennialAssignment'->>'processed' is distinct from '6'
    or result->'perennialAssignment'->>'retired' is distinct from '1'
    or result->>'sourceMetadataStamped' is distinct from 'true'
    or not exists(select 1 from public.app_dataset_revisions where key='ph_master_inventory'
      and state='ready' and source_file_id='erp-3047-fixture' and revision=source_rev)
    or not exists(select 1 from public.ph_inventory_row_assignments
      where master_unique_id='erp-assignment-removed' and not present_in_drive and assignment_reason='source_missing')
    or (select count(*) from public.ph_request_delivery_outbox
      where event_type='eval_assignment_summary' and payload->'unassignedItemcodes' ? 'ERP3047-NEW')<>1 then
    raise exception 'ERP_ASSIGNMENT_FIXTURE_REMOVAL_OR_OUTBOX: %',result;
  end if;
  if (private.decide_inventory_row_owner_v3047('inside','135_ROSES',null,null,null,false,null,array[]::text[])).assignment_reason
    is distinct from 'zone_owner_inactive' then raise exception 'ERP_ASSIGNMENT_FIXTURE_INACTIVE_ZONE_OWNER'; end if;
end
$test$;

do $seed_audit$
begin
  if exists(select 1 from assignment_fixture_default_attempts where code='ERP3047-EXPLICIT')
    or (select count(*) from assignment_fixture_default_attempts where code='ERP3047-NEW')<>1
    or not exists(select 1 from public.ph_warehouse_assigned_items w
      join private.ph_warehouse_assignment_audit a using(assignment_key)
      where w.itemcode_normalized='ERP3047-EXPLICIT' and w.assignedto='erp_assignment_manual'
        and a.old_assignedto is null and a.new_assignedto='erp_assignment_manual') then
    raise exception 'ERP_ASSIGNMENT_FIXTURE_SPECULATIVE_SEED_OR_MISSING_AUDIT';
  end if;
end
$seed_audit$;

create temporary table assignment_fixture_previous as
select a.* from public.ph_inventory_row_assignments a join assignment_fixture_source m on m.unique_id=a.master_unique_id;
create temporary table assignment_fixture_group_writes (master_unique_id text);
create function pg_temp.record_assignment_fixture_group_write()
returns trigger language plpgsql as $probe$
begin
  insert into pg_temp.assignment_fixture_group_writes values(new.master_unique_id);
  return null;
end
$probe$;
create trigger assignment_fixture_group_write after update of master_unique_id,itemcode on public.ph_inventory_row_assignments
for each row execute function pg_temp.record_assignment_fixture_group_write();

create temporary table assignment_fixture_index_writes (master_unique_id text, operation text);
create function pg_temp.record_assignment_fixture_index_write()
returns trigger language plpgsql as $probe$
begin
  insert into pg_temp.assignment_fixture_index_writes values(new.master_unique_id,tg_op);
  return new;
end
$probe$;
create trigger assignment_fixture_index_write before insert or update of unique_id on public.ph_inventory_row_assignments
for each row execute function pg_temp.record_assignment_fixture_index_write();

do $next_revision$
declare run_key uuid := 'a3047000-0000-4000-8000-000000000002'; source_rev bigint; prior_audits integer;
begin
  select count(*) into prior_audits from private.ph_inventory_row_assignment_audit
  where master_unique_id in (select master_unique_id from assignment_fixture_previous);
  perform set_config('agdata.bulk_import.ph_master_inventory','on',true);
  update public.ph_master_inventory set plantgroupcode='NEW_FIXTURE_GROUP' where unique_id='erp-assignment-prior';
  perform set_config('agdata.bulk_import.ph_master_inventory','off',true);
  update assignment_fixture_source set plantgroupcode='NEW_FIXTURE_GROUP' where unique_id='erp-assignment-prior';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_key,array['ph_master_inventory']);
  select revision+1 into source_rev from public.app_dataset_revisions where key='ph_master_inventory';
  perform set_config('agdata.erp.drive_assignment_run_v3047',run_key::text,true);
  perform public.finish_dataset_import_with_sources_v1(run_key,
    '[{"key":"ph_master_inventory","fileName":"erp-3047-next.xlsx","fileId":"erp-3047-next"}]');
  if (select array_agg(master_unique_id) from assignment_fixture_group_writes) is distinct from array['erp-assignment-prior']
    or exists(select 1 from assignment_fixture_index_writes where master_unique_id<>'erp-assignment-prior')
    or (select array_agg(operation order by operation) from assignment_fixture_index_writes)
      is distinct from array['INSERT','UPDATE']
    or exists(select 1 from assignment_fixture_previous p join public.ph_inventory_row_assignments a using(master_unique_id)
      where a.revision<>p.revision+1 or a.source_revision<>source_rev
        or a.unique_id is distinct from p.unique_id or a.policy_revision is distinct from p.policy_revision
        or (a.assignedto,a.assignment_reason,a.review_required) is distinct from (p.assignedto,p.assignment_reason,p.review_required))
    or not exists(select 1 from public.ph_inventory_row_assignments where master_unique_id='erp-assignment-prior'
      and plant_group_code='NEW_FIXTURE_GROUP')
    or (select count(*) from private.ph_inventory_row_assignment_audit where master_unique_id in (
      select master_unique_id from assignment_fixture_previous))<>prior_audits
    or not exists(select 1 from public.app_dataset_revisions where key='ph_master_inventory'
      and state='ready' and source_file_id='erp-3047-next' and revision=source_rev) then
    raise exception 'ERP_ASSIGNMENT_FIXTURE_REVISION_ONLY_OR_PLANT_GROUP_PARITY';
  end if;
end
$next_revision$;
