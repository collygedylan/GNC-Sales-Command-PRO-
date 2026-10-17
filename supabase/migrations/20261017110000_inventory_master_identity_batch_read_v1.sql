begin;

-- Canonicalize only the ERP's recognized numeric spellings. Other item codes
-- remain case-insensitive exact values after surrounding whitespace trim.
create or replace function private.master_identity_item_key_v1(p_value text)
returns text language sql immutable parallel safe set search_path = '' as $function$
  select case
    when upper(btrim(coalesce(p_value,''))) ~ '^[0-9]{6}\.[0-9]{3}\.[0-9]$'
      then replace(upper(btrim(p_value)),'.','')
    when upper(btrim(coalesce(p_value,''))) ~ '^[0-9]{1,10}$'
      then lpad(upper(btrim(p_value)),10,'0')
    else upper(btrim(coalesce(p_value,'')))
  end
$function$;

-- Location normalization preserves punctuation. It only removes whitespace
-- adjacent to dots and pads the known letter.aisle.bay structure.
create or replace function private.master_identity_location_key_v1(p_value text)
returns text language plpgsql immutable parallel safe set search_path = '' as $function$
declare
  normalized text := upper(regexp_replace(btrim(coalesce(p_value,'')), '\s*\.\s*', '.', 'g'));
  parts text[];
begin
  if normalized ~ '^[A-Z]+\.[0-9]{1,2}\.[0-9]{1,3}$' then
    parts := string_to_array(normalized,'.');
    return parts[1]||'.'||lpad(parts[2],2,'0')||'.'||lpad(parts[3],3,'0');
  end if;
  return normalized;
end
$function$;

create index if not exists ph_master_inventory_identity_batch_v1_idx
  on public.ph_master_inventory (
    private.master_identity_item_key_v1(itemcode),
    private.master_identity_location_key_v1(locationcode),
    upper(btrim(coalesce(lotcode,''))),
    upper(btrim(coalesce(source,'')))
  );

create or replace function public.inventory_master_identity_batch_read_v1(
  p_actor_id uuid,
  p_queue_identities jsonb,
  p_expected_revision text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $function$
declare
  actor public.profiles;
  revision_text text;
  revision_state text;
  results jsonb;
begin
  select p.* into actor from public.profiles p
  where p.id=p_actor_id and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now());
  if not found or actor.must_change_password then
    raise exception using errcode='42501',message='MASTER_IDENTITY_ACTOR_FORBIDDEN';
  end if;
  if jsonb_typeof(p_queue_identities) is distinct from 'array' then
    raise exception using errcode='22023',message='MASTER_IDENTITY_QUEUE_INVALID';
  end if;
  if jsonb_array_length(p_queue_identities) < 1 or jsonb_array_length(p_queue_identities) > 100
    or exists (
      select 1 from jsonb_array_elements(p_queue_identities) i(value)
      where jsonb_typeof(value) is distinct from 'object'
        or exists(select 1 from jsonb_object_keys(case when jsonb_typeof(value)='object' then value else '{}'::jsonb end) k(key)
          where key not in ('masterUid','itemCode','locationCode','lotCode','source'))
        or length(coalesce(value->>'masterUid',''))>240
        or length(coalesce(value->>'itemCode',''))>240
        or length(coalesce(value->>'locationCode',''))>160
        or length(coalesce(value->>'lotCode',''))>240
        or length(coalesce(value->>'source',''))>240
        or not (value ? 'lotCode')
        or jsonb_typeof(value->'lotCode') is distinct from 'string'
        or (nullif(btrim(value->>'masterUid'),'') is null and (
          nullif(btrim(value->>'itemCode'),'') is null
          or nullif(btrim(value->>'locationCode'),'') is null))
    ) then
    raise exception using errcode='22023',message='MASTER_IDENTITY_QUEUE_INVALID';
  end if;

  select r.revision::text,r.state into revision_text,revision_state
  from public.app_dataset_revisions r where r.key='ph_master_inventory';
  if revision_state is distinct from 'ready' or revision_text is null then
    raise exception using errcode='40001',message='MASTER_IDENTITY_SOURCE_NOT_READY';
  end if;
  if nullif(p_expected_revision,'') is not null and p_expected_revision<>revision_text then
    raise exception using errcode='40001',message='MASTER_IDENTITY_REVISION_CHANGED';
  end if;

  with input_rows as materialized (
    select ordinality::integer as input_index, value as identity,
      nullif(btrim(value->>'masterUid'),'') as master_uid,
      private.master_identity_item_key_v1(value->>'itemCode') as item_key,
      private.master_identity_location_key_v1(value->>'locationCode') as location_key,
      upper(btrim(value->>'lotCode')) as lot_key,
      case when upper(btrim(coalesce(value->>'source',''))) in ('','DOCK','DOCKS','SOC') then null
        else upper(btrim(value->>'source')) end as source_key
    from jsonb_array_elements(p_queue_identities) with ordinality q(value,ordinality)
  ), matched as (
    select i.input_index, m.unique_id, to_jsonb(m) as full_row
    from input_rows i
    left join lateral (
      select candidate.* from (
        select inv.* from public.ph_master_inventory inv
        where i.master_uid is not null and inv.unique_id=i.master_uid
          and (regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]+', '', 'g') not like '%FOREMAN%'
            or (inv.priority is not null and inv.priority not in ('','-','--','---','N/A','NA','NULL','NONE')))
        union all
        select inv.* from public.ph_master_inventory inv
        where i.master_uid is null
          and private.master_identity_item_key_v1(inv.itemcode)=i.item_key
          and private.master_identity_location_key_v1(inv.locationcode)=i.location_key
          and upper(btrim(coalesce(inv.lotcode,'')))=i.lot_key
          and (i.source_key is null or upper(btrim(coalesce(inv.source,'')))=i.source_key)
          and (regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]+', '', 'g') not like '%FOREMAN%'
            or (inv.priority is not null and inv.priority not in ('','-','--','---','N/A','NA','NULL','NONE')))
      ) candidate
      order by candidate.unique_id
      limit 2
    ) m on true
  ), grouped as (
    select input_index,count(unique_id)::integer as match_count,
      case when count(unique_id)=1 then (array_agg(full_row) filter(where unique_id is not null))[1] else null end as row
    from matched group by input_index
  )
  select coalesce(jsonb_agg(jsonb_build_object('inputIndex',input_index-1,
    'matchCount',least(match_count,2),'row',row) order by input_index),'[]'::jsonb)
  into results from grouped;

  return jsonb_build_object('inventoryRevision',revision_text,'rows',results);
end
$function$;

revoke all on function private.master_identity_item_key_v1(text) from public,anon,authenticated,service_role;
revoke all on function private.master_identity_location_key_v1(text) from public,anon,authenticated,service_role;
grant execute on function private.master_identity_item_key_v1(text) to postgres;
grant execute on function private.master_identity_location_key_v1(text) to postgres;
revoke all on function public.inventory_master_identity_batch_read_v1(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.inventory_master_identity_batch_read_v1(uuid,jsonb,text) to service_role;

commit;
