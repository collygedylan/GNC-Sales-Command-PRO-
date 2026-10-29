begin;
-- Cloud imports preserve the existing prepare/finalize/archive lifecycle.
set local lock_timeout='2s';
set local statement_timeout='15s';
alter table public.ph_transactions_keyed_rows add column if not exists row_state_hash text;
alter table public.ph_pikes_order_source_rows add column if not exists row_state_hash text;
alter table hl_order_private.po_import_rows add column if not exists row_state_hash text
  generated always as (encode(extensions.digest(source::text,'sha256'),'hex')) stored;

create or replace function public.upsert_secondary_erp_delta_v23103(p_source text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_name text; key_names text[]; names text; updates text; conflicts text; changed integer;
begin
  if p_source='transactions_keyed' then
    target_name:='ph_transactions_keyed_rows';
    key_names:=array['drive_file_id','content_sha256','source_sheet_name','source_row_number'];
  elsif p_source in ('pikes','stine_lumber') then
    target_name:='ph_pikes_order_source_rows';key_names:=array['batch_id','source_row_number'];
  else raise exception 'SECONDARY_SOURCE_INVALID'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>1000
    or octet_length(p_rows::text)>4000000 then raise exception 'SECONDARY_BATCH_INVALID'; end if;
  if jsonb_array_length(p_rows)=0 then return jsonb_build_object('changed',0);end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where coalesce(r->>'row_state_hash','') !~ '^[a-f0-9]{64}$')
    then raise exception 'SECONDARY_ROW_HASH_INVALID';end if;
  select string_agg(format('%I',a.attname),',' order by a.attnum),
    string_agg(format('%I=excluded.%I',a.attname,a.attname),',' order by a.attnum) filter(where not(a.attname=any(key_names)))
  into names,updates from pg_attribute a
  where a.attrelid=format('public.%I',target_name)::regclass and a.attnum>0 and not a.attisdropped
    and a.attgenerated='' and a.attname not in ('created_at','matched') and (p_rows->0)?a.attname;
  select string_agg(format('%I',n),',') into conflicts from unnest(key_names)n;
  execute format('insert into public.%I as target (%s) select %s from jsonb_populate_recordset(null::public.%I,$1)
    on conflict (%s) do update set %s where target.row_state_hash is distinct from excluded.row_state_hash',
    target_name,names,names,target_name,conflicts,updates) using p_rows;
  get diagnostics changed=row_count;
  return jsonb_build_object('changed',changed,'unchanged',jsonb_array_length(p_rows)-changed);
end $$;
revoke all on function public.upsert_secondary_erp_delta_v23103(text,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_secondary_erp_delta_v23103(text,jsonb) to service_role;

-- PDF pages already reject changed retries; retain that immutable contract and
-- make the physical row insert explicitly hash-idempotent as well.
do $$ declare definition text; old_fragment text:='from jsonb_array_elements(p_rows) with ordinality r(value,ordinality);'; begin
  definition:=pg_get_functiondef('public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)'::regprocedure);
  if position('po_import_rows.row_state_hash' in definition)=0 then
    if position(old_fragment in definition)=0 then raise exception 'HL_PO_STAGE_CONTRACT_CHANGED';end if;
    definition:=replace(definition,old_fragment,
      'from jsonb_array_elements(p_rows) with ordinality r(value,ordinality) on conflict (import_id,source_file_id,row_index) do update set source=excluded.source where po_import_rows.row_state_hash is distinct from excluded.row_state_hash;');
    execute definition;
  end if;
end $$;
commit;
