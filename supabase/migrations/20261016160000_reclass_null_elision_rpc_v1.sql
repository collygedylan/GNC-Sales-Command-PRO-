begin;

-- Public receipts remain full and immutable in the existing command tables.
-- These service-only adapters encode only the returned row snapshots compactly
-- so the API can reconstruct the exact historical row with its declared keys.
create or replace function private.encode_inventory_reclass_rows_v1(p_receipt jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  row_columns text[];
  compact_rows jsonb:='[]'::jsonb;
  row_count integer;
  valid_keysets boolean;
begin
  if jsonb_typeof(p_receipt) is distinct from 'object'
     or jsonb_typeof(p_receipt->'rows') is distinct from 'array'
     or jsonb_array_length(p_receipt->'rows')=0 then
    return p_receipt;
  end if;
  if exists(select 1 from jsonb_array_elements(p_receipt->'rows') e(value)
      where jsonb_typeof(value) is distinct from 'object'
        or value->>'table' is distinct from 'ph_master_inventory'
        or jsonb_typeof(value->'row') is distinct from 'object') then
    raise exception using errcode='55000',message='INVENTORY_RECLASS_ROW_ENCODING_INVALID';
  end if;
  with source_rows as materialized (
    select e.ordinality::integer row_order,e.value->'row' row_value
    from jsonb_array_elements(p_receipt->'rows') with ordinality e(value,ordinality)
  ), row_keysets as (
    select s.row_order,s.row_value,array_agg(k.key order by k.key) candidate_columns
    from source_rows s cross join lateral jsonb_object_keys(s.row_value) k(key)
    group by s.row_order,s.row_value
  ), first_keyset as (
    select candidate_columns column_names from row_keysets where row_order=1
  ), validated_rows as (
    select s.row_order,s.row_value,
      (select count(*) from jsonb_object_keys(s.row_value))=213
        and not (s.candidate_columns is distinct from f.column_names) valid_keyset
    from row_keysets s cross join first_keyset f
  ), sparse_rows as (
    select s.row_order,s.valid_keyset,jsonb_build_object('table','ph_master_inventory','values',
      s.row_value-coalesce((select array_agg(v.key) from jsonb_each(s.row_value) v(key,value)
        where v.value='null'::jsonb),array[]::text[])) row_value
    from validated_rows s
  )
  select f.column_names,jsonb_agg(r.row_value order by r.row_order),count(*)::integer,
    bool_and(r.valid_keyset)
  into row_columns,compact_rows,row_count,valid_keysets
  from first_keyset f join sparse_rows r on true
  group by f.column_names;
  if row_count<>jsonb_array_length(p_receipt->'rows') or cardinality(row_columns)<>213
     or valid_keysets is distinct from true then
    raise exception using errcode='55000',message='INVENTORY_RECLASS_ROW_SCHEMA_MISMATCH';
  end if;
  return (p_receipt-'rows')||jsonb_build_object('rowEncoding','master-null-elision-v1',
    'rowColumns',to_jsonb(row_columns),'rows',compact_rows);
end
$function$;
revoke all on function private.encode_inventory_reclass_rows_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.apply_inventory_reclass_moves_compact_v1(
  p_actor_id uuid,p_command_id text,p_expected_revision bigint,p_moves jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare receipt jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='INVENTORY_RECLASS_FORBIDDEN';
  end if;
  receipt:=public.apply_inventory_reclass_moves_v1(p_actor_id,p_command_id,p_expected_revision,p_moves);
  return private.encode_inventory_reclass_rows_v1(receipt);
end
$function$;
revoke all on function public.apply_inventory_reclass_moves_compact_v1(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.apply_inventory_reclass_moves_compact_v1(uuid,text,bigint,jsonb) to service_role;

create or replace function public.get_inventory_reclass_move_status_compact_v1(p_actor_id uuid,p_command_id text)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare receipt jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='INVENTORY_RECLASS_FORBIDDEN';
  end if;
  receipt:=public.get_inventory_reclass_move_status_v1(p_actor_id,p_command_id);
  return private.encode_inventory_reclass_rows_v1(receipt);
end
$function$;
revoke all on function public.get_inventory_reclass_move_status_compact_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.get_inventory_reclass_move_status_compact_v1(uuid,text) to service_role;

commit;
