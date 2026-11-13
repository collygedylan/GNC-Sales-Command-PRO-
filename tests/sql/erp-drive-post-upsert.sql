create temp table item6_source_fixture (
  canonical_unique_id text primary key, field_values jsonb not null,
  imported_at timestamptz not null, import_run_id uuid not null
);
create temp table ph_master_bulk_map_v1 (row_number bigint primary key, canonical_unique_id text);
create temp table ph_master_bulk_stage_v1 (row_number bigint primary key, raw_values jsonb, raw_item6_fields text[]);
create temp table item6_note_writes (canonical_unique_id text);

insert into item6_source_fixture
select uid, fields, '2026-10-01 UTC', '00000000-0000-0000-0000-000000000001'
from (values
  ('same', '{"locationnote":"same","priority":7}'::jsonb),
  ('changed', '{"locationnote":"old","priority":7}'),
  ('omitted', '{"locationnote":"preserved","priority":7}'),
  ('unmapped', '{"locationnote":"preserved","priority":7}'),
  ('cleared', '{"locationnote":"old","priority":7}'),
  ('null-same', '{"locationnote":null,"priority":7}'),
  ('missing-key', '{"priority":7}')
) source(uid, fields);

insert into ph_master_bulk_map_v1 values
  (1,'same'),(2,'changed'),(3,'omitted'),(4,null),(5,'cleared'),(6,'null-same'),(7,'missing-key'),(8,'absent-target');
insert into ph_master_bulk_stage_v1 values
  (1,'{"locationnote":"same"}',array['locationnote']), (2,'{"locationnote":"new"}',array['locationnote']),
  (3,'{}',array['priority']), (4,'{"locationnote":"wrong"}',array['locationnote']),
  (5,'{"locationnote":null}',array['locationnote']), (6,'{"locationnote":null}',array['locationnote']),
  (7,'{"locationnote":null}',array['locationnote']), (8,'{"locationnote":"new"}',array['locationnote']);

create function pg_temp.capture_item6_note_write()
returns trigger language plpgsql as $body$
begin
  insert into pg_temp.item6_note_writes values (new.canonical_unique_id);
  return new;
end
$body$;
create trigger capture_item6_note_write before update on item6_source_fixture
for each row execute function pg_temp.capture_item6_note_write();

do $fixture$
declare
  run_id constant uuid := '00000000-0000-0000-0000-000000000002';
  expected_writes constant text[] := array['changed','cleared','missing-key'];
begin
  perform pg_temp.reconcile_drive_item6_location_notes_v3084(run_id);
  if (select array_agg(canonical_unique_id order by canonical_unique_id) from pg_temp.item6_note_writes)
       is distinct from expected_writes then raise exception 'unexpected Item6 writes'; end if;
  if (select array_agg(canonical_unique_id order by canonical_unique_id) from pg_temp.item6_source_fixture where import_run_id=run_id)
       is distinct from expected_writes then raise exception 'Item6 run receipt drift'; end if;
  if exists(select from pg_temp.item6_source_fixture where (import_run_id=run_id) is distinct from (imported_at>'2026-10-01 UTC'))
     or exists(select from pg_temp.item6_source_fixture where field_values->'priority' is distinct from '7'::jsonb)
     then raise exception 'Item6 timestamp or protected field drift'; end if;
  if (select field_values->'locationnote' from pg_temp.item6_source_fixture where canonical_unique_id='changed') is distinct from '"new"'::jsonb
     or (select count(*) from pg_temp.item6_source_fixture where field_values->'locationnote'='null'::jsonb) <> 3
     or (select field_values->'locationnote' from pg_temp.item6_source_fixture where canonical_unique_id='omitted') is distinct from '"preserved"'::jsonb
     then raise exception 'Item6 raw note or JSON null drift'; end if;

  drop table pg_temp.drive_item6_note_delta_v3084;
  insert into pg_temp.ph_master_bulk_map_v1 values (9,'changed'),(10,'changed');
  insert into pg_temp.ph_master_bulk_stage_v1 values
    (9,'{"locationnote":"ambiguous A"}',array['locationnote']), (10,'{"locationnote":"ambiguous B"}',array['locationnote']);
  begin
    perform pg_temp.reconcile_drive_item6_location_notes_v3084(run_id);
    raise exception 'ambiguous Item6 mapping was accepted';
  exception when unique_violation then null;
  end;
  if (select count(*) from pg_temp.item6_note_writes) <> 3 then raise exception 'ambiguous Item6 mapping entered UPDATE'; end if;
end
$fixture$;

select 'compiled DRIVE Item6 verified';
