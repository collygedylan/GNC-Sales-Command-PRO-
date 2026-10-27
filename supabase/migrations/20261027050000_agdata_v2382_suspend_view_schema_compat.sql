begin;
set local lock_timeout='1500ms';
set local statement_timeout='10s';

-- Restore the stable generated browser schema while keeping the exact-row joins.
-- We remove and recreate only the two dependent views; the guard and ordinary
-- DROP VIEW statements fail safely if any other database object depends on them.
do $v2382_view_dependency_guard$
declare unexpected_dependencies text;
begin
  select string_agg(distinct dependent_ns.nspname||'.'||dependent.relname,', ' order by dependent_ns.nspname||'.'||dependent.relname)
    into unexpected_dependencies
  from pg_depend dependency
  join pg_rewrite rule on rule.oid=dependency.objid
  join pg_class dependent on dependent.oid=rule.ev_class
  join pg_namespace dependent_ns on dependent_ns.oid=dependent.relnamespace
  where dependency.refobjid='public.ph_active_suspend'::regclass
    and dependent.relkind='v'
    and dependent.oid not in ('public.ph_active_suspend'::regclass,'public.ph_soc_suspend_tag_rows'::regclass);
  if unexpected_dependencies is not null then
    raise exception 'V2382_SUSPEND_VIEW_UNEXPECTED_DEPENDENCIES: %',unexpected_dependencies;
  end if;
end
$v2382_view_dependency_guard$;

drop view public.ph_soc_suspend_tag_rows;
drop view public.ph_active_suspend;

do $v2382_restore_suspend_view$
declare source_projection text;
begin
  select string_agg(case column_name
    when 'dock' then 'coalesce(nullif(btrim(enriched.dock::text),''''),''Unassigned'') as dock'
    when 'contsize' then 'coalesce(nullif(btrim(enriched.printedcontainercode::text),''''),enriched.containersort) as contsize'
    else format('enriched.%I',column_name)
  end,E',\n    ' order by ordinal_position)
  into source_projection
  from information_schema.columns
  where table_schema='public' and table_name='ph_soc_master'
    and column_name not in ('photo_url','photos','pick_note','status');

  if source_projection is null then raise exception 'V2382_SUSPEND_SOURCE_COLUMNS_MISSING'; end if;
  execute format($view$
create view public.ph_active_suspend with (security_invoker=true) as
with active_soc as materialized (
  select soc.*
  from public.ph_soc_master soc
  where upper(btrim(coalesce(soc.suspend,'')))='SUSPEND'
    and lower(btrim(coalesce(soc.suspend_to,'')))='dc'
    and soc.date_completed is null
    and lower(btrim(coalesce(soc.suspend_candidate_state,'pending'))) not in ('complete','completed','approved','rejected')
)
select %1$s,
  coalesce(case when nullif(regexp_replace(coalesce(inventory.ptronhand::text,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(coalesce(inventory.ptronhand::text,''),'[^0-9.-]','','g')::numeric end,0) as on_hand,
  coalesce(case when nullif(regexp_replace(coalesce(inventory.ptrreviewed::text,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(coalesce(inventory.ptrreviewed::text,''),'[^0-9.-]','','g')::numeric end,0) as review,
  coalesce(case when nullif(regexp_replace(coalesce(inventory.ptravailable::text,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(coalesce(inventory.ptravailable::text,''),'[^0-9.-]','','g')::numeric end,0) as available,
  coalesce(case when nullif(regexp_replace(coalesce(inventory.s_lts::text,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(coalesce(inventory.s_lts::text,''),'[^0-9.-]','','g')::numeric end,0) as open_stock,
  case when nullif(regexp_replace(coalesce(inventory.loc_photo_match::text,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(coalesce(inventory.loc_photo_match::text,''),'[^0-9.-]','','g')::numeric end as loc_photo_match,
  coalesce(location.loc_on_hand,0) as loc_on_hand,
  'Pending'::text as status,
  'suspend_tag'::text as request_type,
  true as is_suspend_tag,
  soc.suspend_to as suspendto,
  soc.stopnumber as drop_number,
  coalesce(case when nullif(regexp_replace(coalesce(soc.quantityshipped::text,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(coalesce(soc.quantityshipped::text,''),'[^0-9.-]','','g')::numeric end,
    case when nullif(regexp_replace(coalesce(soc.quantityordered::text,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(coalesce(soc.quantityordered::text,''),'[^0-9.-]','','g')::numeric end,0) as qty,
  coalesce(soc.consigneename,soc.customername) as consignee,
  coalesce(soc.customername,soc.consigneename) as customer,
  soc.salesrepname as sales_rep
from active_soc soc
left join lateral (
  select master.*
  from public.ph_master_inventory master
  where lower(btrim(coalesce(master.itemcode::text,'')))=lower(btrim(coalesce(soc.itemcode::text,'')))
    and lower(btrim(coalesce(master.locationcode::text,'')))=lower(btrim(coalesce(soc.locationcode::text,'')))
    and lower(btrim(coalesce(soc.locationcode::text,''))) !~ '^0+[.]0+[.]111$'
    and (nullif(lower(btrim(coalesce(soc.lotcode::text,''))),'') is null
      or lower(btrim(coalesce(master.lotcode::text,'')))=lower(btrim(coalesce(soc.lotcode::text,''))))
  order by master.unique_id
  limit 1
) inventory on true
cross join lateral jsonb_populate_record(null::public.ph_soc_master,
  to_jsonb(soc)||jsonb_build_object(
    'dock',coalesce(nullif(btrim(soc.dock::text),''),'Unassigned'),
    'contsize',coalesce(nullif(btrim(soc.printedcontainercode::text),''),soc.containersort),
    'priority',inventory.priority,
    'holdstopcode',inventory.holdstopcode,
    'holdstopreason',inventory.holdstopreason,
    'itemspec',inventory.itemspec,
    'spec',inventory.spec,
    'photo_link',coalesce(inventory.photo_url,inventory.photo_link),
    'photo_name',inventory.photo_name
  )) enriched
left join lateral (
  select sum(coalesce(case when nullif(regexp_replace(coalesce(master.ptronhand::text,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(coalesce(master.ptronhand::text,''),'[^0-9.-]','','g')::numeric end,0)) loc_on_hand
  from public.ph_master_inventory master
  where inventory.unique_id is not null
    and lower(btrim(coalesce(master.itemcode::text,'')))=lower(btrim(coalesce(soc.itemcode::text,'')))
    and lower(btrim(coalesce(master.locationcode::text,'')))=lower(btrim(coalesce(soc.locationcode::text,'')))
) location on true;
$view$,source_projection);
end
$v2382_restore_suspend_view$;

create view public.ph_soc_suspend_tag_rows with (security_invoker=true) as
select * from public.ph_active_suspend;
grant select on public.ph_active_suspend,public.ph_soc_suspend_tag_rows to anon,authenticated,service_role;
notify pgrst,'reload schema';

do $v2382_schema_contract$
begin
  if exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='ph_active_suspend' and column_name=any(array['hsreasonbegin','holdstopbegindate','photo_url','photos','photo_date','match_level'])) then
    raise exception 'V2382_SUSPEND_GENERATED_SCHEMA_MISMATCH';
  end if;
  if not exists(select 1 from pg_class where oid='public.ph_active_suspend'::regclass and reloptions @> array['security_invoker=true'])
    or not exists(select 1 from pg_class where oid='public.ph_soc_suspend_tag_rows'::regclass and reloptions @> array['security_invoker=true']) then
    raise exception 'V2382_SUSPEND_INVOKER_MODE_REQUIRED';
  end if;
  if (select count(*) from public.ph_active_suspend)<>(select count(*) from public.ph_soc_master
    where upper(btrim(coalesce(suspend,'')))='SUSPEND' and lower(btrim(coalesce(suspend_to,'')))='dc'
      and date_completed is null and lower(btrim(coalesce(suspend_candidate_state,'pending'))) not in ('complete','completed','approved','rejected')) then
    raise exception 'V2382_SUSPEND_ACTIVE_COUNT_MISMATCH';
  end if;
end
$v2382_schema_contract$;
commit;
