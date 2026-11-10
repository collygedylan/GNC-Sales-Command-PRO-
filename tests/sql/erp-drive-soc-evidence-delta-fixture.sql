create temporary table drive_evidence_source (like public.ph_master_inventory including defaults);
create temporary table soc_evidence_target (like public.ph_soc_master including defaults);
create temporary table soc_evidence_statements (written boolean);

create function pg_temp.record_soc_evidence_statement()
returns trigger language plpgsql as $probe$
begin
  insert into pg_temp.soc_evidence_statements values(true);
  return null;
end
$probe$;
create trigger soc_evidence_probe after update on soc_evidence_target
for each statement execute function pg_temp.record_soc_evidence_statement();

-- Execute the installed trigger body against only the disposable source and
-- target tables, keeping its transition names and destination predicates.
do $fixture$
declare definition text := pg_get_functiondef('private.publish_drive_evidence_to_soc_v23142()'::regprocedure);
begin
  definition:=replace(definition,'public.ph_soc_master','pg_temp.soc_evidence_target');
  execute replace(definition,'public.ph_master_inventory','pg_temp.drive_evidence_source');
end
$fixture$;
create trigger drive_evidence_fixture after update on drive_evidence_source
referencing old table as old_drive_evidence new table as new_drive_evidence
for each statement execute function private.publish_drive_evidence_to_soc_v23142();

do $markers$
declare installed_trigger record;
begin
  for installed_trigger in select oid from pg_trigger
    where tgrelid='public.ph_master_inventory'::regclass
      and tgfoid=to_regprocedure('private.mark_drive_soc_evidence_delta_v3048()') loop
    execute regexp_replace(pg_get_triggerdef(installed_trigger.oid),
      ' ON (public[.])?ph_master_inventory ', ' ON pg_temp.drive_evidence_source ');
  end loop;
end
$markers$;

insert into drive_evidence_source(unique_id,itemcode,locationcode,lotcode,priority,ptronhand)
values ('drive-evidence-exact','000154.020.1','L.05.000','28.F1','1','435'),
  ('drive-evidence-blank','000154.020.1','L.05.002','','1','10');
insert into soc_evidence_target(unique_id,itemcode,locationcode,lotcode,priority)
values ('soc-evidence-exact','000154.020.1','L.05.000','28.F1','1'),
  ('soc-evidence-lot','000154.020.1','L.05.000','27.F1','1'),
  ('soc-evidence-location','000154.020.1','L.05.001','28.F1','1'),
  ('soc-evidence-priority','000154.020.1','L.05.000','28.F1','2'),
  ('soc-evidence-blank','000154.020.1','L.05.002','','1');

select set_config('gnc.drive_soc_evidence_delta_1','on',true);
update drive_evidence_source set ptronhand='430',filename='fixture-new.xlsx'
where unique_id in ('drive-evidence-exact','drive-evidence-blank');
do $test$
begin
  if exists(select 1 from soc_evidence_statements) then
    raise exception 'ERP_DRIVE_SOC_NOOP_EXECUTED_UPDATE';
  end if;
  if to_regprocedure('private.mark_drive_soc_evidence_delta_v3048()') is not null
    and current_setting('gnc.drive_soc_evidence_delta_1',true) is distinct from 'off' then
    raise exception 'ERP_DRIVE_SOC_SPOOFED_MARKER_NOT_RESET';
  end if;
end
$test$;

update drive_evidence_source set photo_link='https://fixture/exact.jpg',photo_name='exact.jpg',
  photo_url='https://fixture/exact.jpg',photos='[{"url":"https://fixture/exact.jpg"}]',
  spec='32-36" H',caliper='2"',av_note='SPEC - 32-36" H',pick_note='good',match='80',loc_match_qty='348'
where unique_id in ('drive-evidence-exact','drive-evidence-blank');
do $test$
begin
  if (select count(*) from soc_evidence_statements)<>1
    or not exists(select 1 from soc_evidence_target where unique_id='soc-evidence-exact'
      and photo_link='https://fixture/exact.jpg' and dock_photo_link=photo_link
      and dock_spec='32-36" H' and loc_match_qty='348')
    or exists(select 1 from soc_evidence_target where unique_id<>'soc-evidence-exact' and photo_link is not null) then
    raise exception 'ERP_DRIVE_SOC_EXACT_EVIDENCE_NOT_PROPAGATED';
  end if;
end
$test$;

insert into drive_evidence_source(unique_id,itemcode,locationcode,lotcode,priority,ptronhand)
values ('drive-evidence-ambiguous','000154.020.1','L.05.000','28.F1','1','12');
update drive_evidence_source set photo_link='https://fixture/ambiguous.jpg' where unique_id='drive-evidence-exact';
do $test$
begin
  if (select photo_link from soc_evidence_target where unique_id='soc-evidence-exact')
      is distinct from 'https://fixture/exact.jpg' then
    raise exception 'ERP_DRIVE_SOC_AMBIGUOUS_EVIDENCE_PROPAGATED';
  end if;
end
$test$;

select set_config('app.eval_publication_v309','on',true);
update drive_evidence_source set photo_link='https://fixture/canonical-owner.jpg' where unique_id='drive-evidence-exact';
do $test$
begin
  if (select count(*) from soc_evidence_statements)<>2 then
    raise exception 'ERP_DRIVE_SOC_CANONICAL_OWNER_BYPASS_CHANGED';
  end if;
end
$test$;

create function pg_temp.drive_soc_fixture_nested_update()
returns trigger language plpgsql as $nested$
begin
  if new.ptronhand='431' then
    update pg_temp.drive_evidence_source set ptronhand='31' where unique_id='drive-evidence-nested';
  elsif new.ptronhand='432' then
    update pg_temp.drive_evidence_source set pick_note='nested-change' where unique_id='drive-evidence-nested';
  end if;
  return null;
end
$nested$;

do $statement_cases$
declare baseline integer;
begin
  if to_regprocedure('private.mark_drive_soc_evidence_delta_v3048()') is null then return; end if;
  perform set_config('app.eval_publication_v309','off',true);
  create unique index on drive_evidence_source(unique_id);
  select count(*) into baseline from soc_evidence_statements;
  insert into drive_evidence_source(unique_id,itemcode,locationcode,lotcode,priority,ptronhand)
  values ('drive-evidence-outer','000154.020.1','L.05.006','28.F1','1','430'),
    ('drive-evidence-nested','000154.020.1','L.05.007','28.F1','1','30')
  on conflict(unique_id) do update set pick_note=excluded.pick_note;
  insert into soc_evidence_target(unique_id,itemcode,locationcode,lotcode,priority)
  values ('soc-evidence-outer','000154.020.1','L.05.006','28.F1','1'),
    ('soc-evidence-nested','000154.020.1','L.05.007','28.F1','1');
  if (select count(*) from soc_evidence_statements)<>baseline then
    raise exception 'ERP_DRIVE_SOC_INSERT_ONLY_UPSERT_EXECUTED_UPDATE';
  end if;

  create trigger z_drive_soc_nested_fixture after update of ptronhand on drive_evidence_source
  for each row when (new.unique_id='drive-evidence-outer') execute function pg_temp.drive_soc_fixture_nested_update();
  update drive_evidence_source set ptronhand='431',pick_note='outer-change' where unique_id='drive-evidence-outer';
  if (select count(*) from soc_evidence_statements)<>baseline+1
    or (select pick_note from soc_evidence_target where unique_id='soc-evidence-outer') is distinct from 'outer-change'
    or (select pick_note from soc_evidence_target where unique_id='soc-evidence-nested') is not null then
    raise exception 'ERP_DRIVE_SOC_NESTED_STOCK_CLEARED_OUTER_EVIDENCE';
  end if;

  update drive_evidence_source set ptronhand='432' where unique_id='drive-evidence-outer';
  if (select count(*) from soc_evidence_statements)<>baseline+2
    or (select pick_note from soc_evidence_target where unique_id='soc-evidence-nested') is distinct from 'nested-change' then
    raise exception 'ERP_DRIVE_SOC_NESTED_EVIDENCE_LEAKED_TO_OUTER_STATEMENT';
  end if;

  begin
    update drive_evidence_source set pick_note='rolled-back' where unique_id='drive-evidence-outer';
    raise exception using errcode='P0590',message='fixture subtransaction rollback';
  exception when sqlstate 'P0590' then null;
  end;
  update drive_evidence_source set filename='after-rollback.xlsx' where unique_id='drive-evidence-outer';
  if (select count(*) from soc_evidence_statements)<>baseline+2
    or (select pick_note from soc_evidence_target where unique_id='soc-evidence-outer') is distinct from 'outer-change'
    or current_setting('gnc.drive_soc_evidence_delta_1',true) is distinct from 'off'
    or current_setting('gnc.drive_soc_evidence_delta_2',true) is distinct from 'off' then
    raise exception 'ERP_DRIVE_SOC_ROLLBACK_LEFT_EVIDENCE_MARKER';
  end if;

  insert into drive_evidence_source(unique_id,pick_note) values ('drive-evidence-outer','upsert-change')
  on conflict(unique_id) do update set pick_note=excluded.pick_note;
  if (select count(*) from soc_evidence_statements)<>baseline+3
    or (select pick_note from soc_evidence_target where unique_id='soc-evidence-outer') is distinct from 'upsert-change' then
    raise exception 'ERP_DRIVE_SOC_CONFLICT_UPDATE_LOST_EVIDENCE';
  end if;
end
$statement_cases$;

create temporary table soc_evidence_row_writes (unique_id text);
create function pg_temp.record_soc_evidence_row()
returns trigger language plpgsql as $row_probe$
begin
  insert into pg_temp.soc_evidence_row_writes values(new.unique_id);
  return null;
end
$row_probe$;
create trigger soc_evidence_row_probe after update on soc_evidence_target
for each row execute function pg_temp.record_soc_evidence_row();

select set_config('app.eval_publication_v309','off',true);
insert into drive_evidence_source(unique_id,itemcode,locationcode,lotcode,priority,spec,caliper,
  photo_link,photo_name,photo_url,photos,loc_match_qty,date_completed)
values ('drive-retained-no-photo','000154.020.1','L.05.010','28.F1','1','Old spec','Old caliper',
    null,null,null,'[]',null,'2026-11-01T00:00:00Z'),
  ('drive-retained-suspend','000154.020.1','L.05.011','28.F1','1','Keep spec','Keep caliper',
    'https://fixture/archive.jpg','archive.jpg','https://fixture/archive.jpg','[{"url":"https://fixture/archive.jpg"}]',
    '18','2026-11-01T00:00:00Z');
insert into soc_evidence_target(unique_id,itemcode,locationcode,lotcode,priority,suspend,
  photo_link,photo_name,photo_url,photos,dock_photo_link,dock_photo_name,dock_spec,dock_caliper,loc_match_qty,date_completed)
values ('soc-retained-no-photo','000154.020.1','L.05.010','28.F1','1',null,
    null,null,null,'[]','https://fixture/old.jpg','old.jpg','Dock spec','Dock caliper',null,'2026-11-02T00:00:00Z'),
  ('soc-retained-suspend','000154.020.1','L.05.011','28.F1','1','Suspend',
    'https://fixture/archive.jpg','archive.jpg','https://fixture/archive.jpg','[{"url":"https://fixture/archive.jpg"}]',
    'https://fixture/archive.jpg','archive.jpg','Keep spec','Keep caliper','18','2026-11-02T00:00:00Z');

update drive_evidence_source set spec='New spec',caliper='New caliper',date_completed='2026-11-03T00:00:00Z'
where unique_id='drive-retained-no-photo';
update drive_evidence_source set date_completed='2026-11-03T00:00:00Z'
where unique_id='drive-retained-suspend';
do $no_op$
begin
  if exists(select 1 from soc_evidence_row_writes) then
    raise exception 'ERP_DRIVE_SOC_RETAINED_DOCK_VALUES_CAUSED_ROW_WRITE';
  end if;
end
$no_op$;

update drive_evidence_source set photo_link=null,photo_name=null,photo_url=null,photos='[]',
  loc_match_qty='0',date_completed=null where unique_id='drive-retained-suspend';
do $expiry$
begin
  if (select array_agg(unique_id) from soc_evidence_row_writes) is distinct from array['soc-retained-suspend']
    or not exists(select 1 from soc_evidence_target where unique_id='soc-retained-suspend'
      and photo_link is null and photo_name is null and photo_url is null and photos='[]'
      and dock_photo_link='https://fixture/archive.jpg' and dock_photo_name='archive.jpg'
      and dock_spec='Keep spec' and dock_caliper='Keep caliper' and loc_match_qty='0'
      and date_completed='2026-11-02T00:00:00Z') then
    raise exception 'ERP_DRIVE_SOC_EXPIRY_LOST_OPERATIONAL_OR_DOCK_EVIDENCE';
  end if;
end
$expiry$;
