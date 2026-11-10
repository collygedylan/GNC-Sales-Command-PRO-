begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- UPDATE has statement transition tables even when no evaluation data changed.
-- The executor tests the exact old/new evidence tuple before queuing the rare
-- row marker. The statement publisher can then skip opening transition data.
create function private.mark_drive_soc_evidence_delta_v3048()
returns trigger language plpgsql set search_path='' as $marker$
declare
  marker text := 'gnc.drive_soc_evidence_delta_' || pg_trigger_depth();
begin
  if tg_level='STATEMENT' then
    perform set_config(marker,'off',true);
  elsif current_setting(marker,true) is distinct from 'on' then
    perform set_config(marker,'on',true);
  end if;
  return null;
end
$marker$;
revoke all on function private.mark_drive_soc_evidence_delta_v3048()
  from public,anon,authenticated,service_role;

create trigger a000_drive_soc_evidence_reset_v3048 before update on public.ph_master_inventory
for each statement execute function private.mark_drive_soc_evidence_delta_v3048();

create trigger a000_drive_soc_evidence_mark_v3048 after update on public.ph_master_inventory
for each row when (
  (old.photo_link,old.spec,old.caliper,old.av_note,old.pick_note,old.match,old.loc_match_qty,old.date_completed)
  is distinct from
  (new.photo_link,new.spec,new.caliper,new.av_note,new.pick_note,new.match,new.loc_match_qty,new.date_completed)
) execute function private.mark_drive_soc_evidence_delta_v3048();

do $publication$
declare
  publisher regprocedure := 'private.publish_drive_evidence_to_soc_v23142()'::regprocedure;
  definition text := pg_get_functiondef(publisher);
  begin_at integer := strpos(definition,'begin'||chr(10)||'  if current_setting(''app.eval_publication_v309'',true)');
  join_at integer := strpos(definition,'  if not exists(select 1 from new_drive_evidence');
  delta_at integer := strpos(definition,'  with changed_drive_evidence as materialized (');
begin
  if begin_at=0 or join_at<=begin_at or delta_at<=join_at
    or not exists(select 1 from pg_trigger t where t.tgfoid=publisher
      and t.tgrelid='public.ph_master_inventory'::regclass and t.tgtype=16
      and t.tgoldtable='old_drive_evidence' and t.tgnewtable='new_drive_evidence') then
    raise exception 'ERP_DRIVE_SOC_EVIDENCE_MARKER_ANCHOR_MISSING';
  end if;
  execute overlay(definition placing $body$declare
  marker text := 'gnc.drive_soc_evidence_delta_' || pg_trigger_depth();
begin
  if current_setting(marker,true) is distinct from 'on' then return null; end if;
  perform set_config(marker,'off',true);
  if current_setting('app.eval_publication_v309',true)='on' then return null; end if;

$body$ from begin_at for delta_at-begin_at);
end
$publication$;
commit;
