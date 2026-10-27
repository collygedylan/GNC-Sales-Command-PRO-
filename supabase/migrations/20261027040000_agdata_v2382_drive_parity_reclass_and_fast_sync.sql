begin;
set local lock_timeout='1500ms';
set local statement_timeout='10s';

-- Queue cards must use the same physical row as Drive: item + location + lot.
-- Lot fallback is allowed only for legacy SOC rows with no lot and is pinned
-- to the same location; false-block locations never join inventory.
do $v2382_suspend_view$
declare source_projection text;
begin
  -- v2378 appended these SOC columns after the existing view was created.
  -- Keep the original output order, then append only the new exact-master fields.
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
create or replace view public.ph_active_suspend with (security_invoker=true) as
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
  soc.salesrepname as sales_rep,
  inventory.hsreasonbegin as hsreasonbegin,
  inventory.holdstopbegindate as holdstopbegindate,
  inventory.photo_url as photo_url,
  inventory.photos as photos,
  inventory.photo_date as photo_date,
  case when inventory.unique_id is null then null
    when nullif(lower(btrim(coalesce(soc.lotcode::text,''))),'') is null then 'item-location'
    else 'item-location-lot' end as match_level
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
    'holdstopbegindate',inventory.holdstopbegindate,
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
$v2382_suspend_view$;

create or replace view public.ph_soc_suspend_tag_rows with (security_invoker=true) as
select * from public.ph_active_suspend;

grant select on public.ph_active_suspend,public.ph_soc_suspend_tag_rows to anon,authenticated,service_role;
notify pgrst,'reload schema';

do $v2382_suspend_parity_contract$
begin
  if (select count(*) from public.ph_active_suspend)<>
     (select count(*) from public.ph_soc_master where upper(btrim(coalesce(suspend,'')))='SUSPEND'
       and lower(btrim(coalesce(suspend_to,'')))='dc' and date_completed is null
       and lower(btrim(coalesce(suspend_candidate_state,'pending'))) not in ('complete','completed','approved','rejected')) then
    raise exception 'V2382_SUSPEND_ACTIVE_COUNT_MISMATCH';
  end if;
  if not exists(select 1 from pg_class where oid='public.ph_active_suspend'::regclass
      and reloptions @> array['security_invoker=true']) then
    raise exception 'V2382_SUSPEND_SECURITY_MODE_CHANGED';
  end if;
end
$v2382_suspend_parity_contract$;
commit;
