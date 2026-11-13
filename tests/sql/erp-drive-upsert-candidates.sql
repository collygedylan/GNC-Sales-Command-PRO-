create temp table drive_fixture_master (unique_id text primary key, quantity int);
create temp table drive_fixture_prior (unique_id text primary key, source_hash text);
create temp table ph_master_bulk_stage_v1 (row_number bigint primary key, unique_id text, source_hash text, quantity int, erp_work_cohort int);
create temp table ph_master_bulk_map_v1 (row_number bigint primary key, canonical_unique_id text);
create temp table pending_ack_uids_v3084 (unique_id text primary key);
create temp table drive_conflict_source_hash_v3084 (unique_id text primary key, source_hash text);
create temp table drive_fixture_insert_attempts (unique_id text primary key);

insert into drive_fixture_master values ('unchanged',10), ('changed',10), ('pending',10), ('recheck',10), ('exact',10), ('other',10);
insert into drive_fixture_prior select unique_id,'old' from drive_fixture_master;
insert into ph_master_bulk_stage_v1 values
  (1,'unchanged-source','old',99,1), (2,'changed-source','new',20,1),
  (3,'pending-source','old',30,1), (4,'recheck-source','new',40,1),
  (5,'new-source','new',50,1), (6,'exact','old',99,1), (7,'other-source','new',99,2),
  (8,'exact-changed','new',80,1);
insert into ph_master_bulk_map_v1 values
  (1,'unchanged'),(2,'changed'),(3,'pending'),(4,'recheck'),(5,null),(6,'exact'),(7,'other'),(8,'exact-changed');
insert into drive_fixture_master values ('exact-changed',10);
insert into drive_fixture_prior values ('exact-changed','old');
insert into pending_ack_uids_v3084 values ('pending');
insert into drive_conflict_source_hash_v3084 values ('unchanged','old'),('changed','new'),('pending','old'),('recheck','old');

create function pg_temp.capture_drive_fixture_insert()
returns trigger language plpgsql as $body$
begin
  insert into pg_temp.drive_fixture_insert_attempts values (new.unique_id);
  return new;
end
$body$;
create trigger drive_fixture_insert before insert on drive_fixture_master
for each row execute function pg_temp.capture_drive_fixture_insert();

do $fixture$
declare
  guarded_update text := $update$with affected as (
         update public.ph_master_inventory target set quantity=s.quantity
         from pg_temp.ph_master_bulk_stage_v1 s
         join pg_temp.ph_master_bulk_map_v1 mapped using (row_number)
         where mapped.canonical_unique_id=s.unique_id and target.unique_id=s.unique_id
           and s.erp_work_cohort=1 and not exists (select 1 from pg_temp.drive_fixture_prior prior
             where prior.unique_id=target.unique_id and prior.source_hash=s.source_hash)
         returning target.unique_id
       ) select count(*) from affected$update$;
  upsert_query text := $upsert$with affected as (
         insert into public.ph_master_inventory as target (unique_id,quantity)
         select coalesce(mapped.canonical_unique_id,s.unique_id),s.quantity from pg_temp.ph_master_bulk_stage_v1 s
         join pg_temp.ph_master_bulk_map_v1 mapped using (row_number)
         where s.erp_work_cohort=1 and mapped.canonical_unique_id is distinct from s.unique_id
           and (mapped.canonical_unique_id is null or not exists (select 1 from pg_temp.drive_fixture_prior prior
             where prior.unique_id=mapped.canonical_unique_id and prior.source_hash=s.source_hash)
             or exists(select 1 from pg_temp.pending_ack_uids_v3084 ack where ack.unique_id=mapped.canonical_unique_id))
         on conflict (unique_id) do update set quantity=excluded.quantity
         where (select source.source_hash from pg_temp.drive_conflict_source_hash_v3084 source where source.unique_id=target.unique_id)
           is distinct from (select prior.source_hash from pg_temp.drive_fixture_prior prior where prior.unique_id=target.unique_id)
           or exists(select 1 from pg_temp.pending_ack_uids_v3084 ack where ack.unique_id=target.unique_id)
         returning unique_id
       ) select array_agg(unique_id order by unique_id) from affected$upsert$;
  affected text[];
  attempts text[];
  updated integer;
begin
  if pg_temp.filter_drive_upsert_candidates_v3084(guarded_update) is distinct from guarded_update then
    raise exception 'upsert filter altered legacy direct UPDATE';
  end if;
  if pg_temp.filter_drive_update_candidates_v3084(upsert_query) is distinct from upsert_query then
    raise exception 'update filter altered upsert';
  end if;
  execute replace(pg_temp.filter_drive_update_candidates_v3084(guarded_update), 'public.ph_master_inventory','pg_temp.drive_fixture_master') into updated;
  if updated is distinct from 1 then raise exception 'direct UPDATE changed the wrong cohort: %', updated; end if;
  execute replace(pg_temp.filter_drive_upsert_candidates_v3084(upsert_query), 'public.ph_master_inventory','pg_temp.drive_fixture_master') into affected;
  select array_agg(unique_id order by unique_id) into attempts from pg_temp.drive_fixture_insert_attempts;
  if attempts is distinct from array['changed','new-source','pending','recheck'] then
    raise exception 'incorrect rows reached INSERT before conflict: %', attempts;
  end if;
  if affected is distinct from array['changed','new-source','pending'] then
    raise exception 'conflict recheck or acknowledgement changed: %', affected;
  end if;
  if (select array_agg(quantity order by unique_id) from pg_temp.drive_fixture_master)
       is distinct from array[20,10,80,50,10,30,10,10] then
    raise exception 'unexpected master values after guarded upsert';
  end if;
end
$fixture$;

select 'compiled DRIVE candidates verified';
