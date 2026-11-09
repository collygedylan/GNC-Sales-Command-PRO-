begin;
-- Reproduce the installed SOC generated aliases only in the disposable replay.
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_SOC_COLUMNS_REQUIRE_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
alter table public.ph_soc_master
  add column stop text generated always as (COALESCE(stopnumber, ''::text)) stored,
  add column drop_number text generated always as (COALESCE(stopnumber, ''::text)) stored,
  add column itemcode_canonical text generated always as (rtrim(btrim(COALESCE(itemcode, ''::text)), '.'::text)) stored,
  add column common_name text generated always as (COALESCE(commonname, ''::text)) stored,
  add column location text generated always as (COALESCE(locationcode, ''::text)) stored,
  add column saleyear text generated always as (split_part(COALESCE(lotcode, ''::text), '.'::text, 1)) stored,
  add column pri text generated always as (COALESCE(priority, ''::text)) stored,
  add column qty numeric generated always as (CASE WHEN (btrim(COALESCE(quantityordered, ''::text)) ~ '^-?[0-9]+([.][0-9]+)?$'::text) THEN (btrim(quantityordered))::numeric ELSE (0)::numeric END) stored,
  add column ordered_qty numeric generated always as (CASE WHEN (btrim(COALESCE(quantityordered, ''::text)) ~ '^-?[0-9]+([.][0-9]+)?$'::text) THEN (btrim(quantityordered))::numeric ELSE (0)::numeric END) stored,
  add column plan_start text generated always as (COALESCE(planstart, ''::text)) stored,
  add column consignee text generated always as (COALESCE(consigneename, ''::text)) stored,
  add column customer text generated always as (COALESCE(customername, ''::text)) stored,
  add column salesrep text generated always as (COALESCE(salesrepname, salesrepid, ''::text)) stored,
  add column sales_rep text generated always as (COALESCE(salesrepname, salesrepid, ''::text)) stored,
  add column loc_photo_match numeric generated always as (CASE WHEN (btrim(COALESCE(loc_match_qty, ''::text)) ~ '^-?[0-9]+([.][0-9]+)?$'::text) THEN (btrim(loc_match_qty))::numeric ELSE (0)::numeric END) stored,
  add column match_pct numeric generated always as (CASE WHEN (btrim(COALESCE(match, ''::text)) ~ '^-?[0-9]+([.][0-9]+)?$'::text) THEN (btrim(match))::numeric ELSE (0)::numeric END) stored,
  add column eval_user text generated always as (COALESCE(assignedto, ''::text)) stored,
  add column completed boolean generated always as ((((date_completed IS NOT NULL) AND (NULLIF(btrim(suspend), ''::text) IS NULL)) OR (lower(COALESCE(status, ''::text)) = ANY (ARRAY['completed'::text, 'deleted'::text])))) stored,
  add column suspend_completed boolean generated always as ((((date_completed IS NOT NULL) AND (NULLIF(btrim(suspend), ''::text) IS NULL)) OR (lower(COALESCE(status, ''::text)) = ANY (ARRAY['completed'::text, 'deleted'::text])))) stored;

alter table public.user_access add column view_all_suspend text not null default 'N'
  constraint user_access_view_all_suspend_check check (view_all_suspend in ('Y','N'));

create table private.dock_duplicate_archive_v23183 (
  source_uid text primary key,
  row_value jsonb not null,
  archived_at timestamptz not null default now()
);
create table private.dock_suspend_closed_lines_v23183 (
  source_uid text primary key,
  business_key text not null,
  completed_at timestamptz not null
);
create index dock_suspend_closed_business_v23183 on private.dock_suspend_closed_lines_v23183(business_key);
create table private.soc_retired_rows_v23184 (
  source_uid text primary key,
  row_value jsonb not null,
  reason text not null,
  archived_at timestamptz not null default now()
);
revoke all on private.dock_duplicate_archive_v23183, private.dock_suspend_closed_lines_v23183,
  private.soc_retired_rows_v23184 from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.dock_order_business_key_v23183(p_row jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_array(
 regexp_replace(regexp_replace(btrim(coalesce(nullif(p_row->>'dock',''),p_row->>'dock_num','')),'^dock[[:space:]]*','','i'),'[.]0+$',''),
 regexp_replace(btrim(coalesce(p_row->>'stopnumber','')),'[.]0+$',''),
 upper(rtrim(btrim(coalesce(p_row->>'itemcode','')),'.')),
 upper(btrim(coalesce(p_row->>'locationcode',''))),btrim(coalesce(p_row->>'consigneename','')),
 case when btrim(coalesce(p_row->>'quantityordered','')) ~ '^-?[0-9]+([.][0-9]+)?$' then (p_row->>'quantityordered')::numeric else 0 end)::text
$function$;

CREATE OR REPLACE FUNCTION private.normalize_soc_dock_number_v23184(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 with value as (select regexp_replace(regexp_replace(btrim(coalesce(p_value,'')),'^dock[[:space:]]*','','i'),'[.]0+$','') v)
 select case when v ~ '^[0-9]+$' and v ~ '[1-9]' then regexp_replace(v,'^0+','') else null end from value
$function$;

CREATE OR REPLACE FUNCTION private.queue_scope_actor_v23159(p_queue text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT case when (case p_queue when 'request' then a.view_all_requests else a.view_all_suspend end)='Y' then '*' else private.access_username_v23119(p.username) end FROM private.current_active_profile() p LEFT JOIN public.user_access a ON a.profile_id=p.id WHERE p.id IS NOT NULL $function$;
revoke all on function private.queue_scope_actor_v23159(text),
  private.dock_order_business_key_v23183(jsonb), private.normalize_soc_dock_number_v23184(text)
  from public, anon, authenticated, service_role;
grant execute on function private.queue_scope_actor_v23159(text) to anon, authenticated, service_role;
commit;
