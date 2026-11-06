CREATE OR REPLACE FUNCTION private.merge_compact_history_state_v2366()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  existing_key text;
  incoming_file_id text;
  incoming_file_name text;
  incoming_seen_at timestamptz;
begin
  if current_setting('agdata.archive_dedup',true)='on' then return new; end if;
  incoming_file_id:=coalesce(new.source_file_id,new.source_unique_id);
  incoming_file_name:=coalesce(new.source_file_name,incoming_file_id);
  incoming_seen_at:=coalesce(new.archived_at,new.updated_at,clock_timestamp());
  new.first_seen_at:=coalesce(new.first_seen_at,incoming_seen_at);
  new.last_seen_at:=greatest(coalesce(new.last_seen_at,incoming_seen_at),incoming_seen_at);
  new.first_file_id:=coalesce(new.first_file_id,incoming_file_id);
  new.last_file_id:=coalesce(incoming_file_id,new.last_file_id);
  new.first_file_name:=coalesce(new.first_file_name,incoming_file_name);
  new.last_file_name:=coalesce(incoming_file_name,new.last_file_name);
  new.seen_count:=greatest(coalesce(new.seen_count,1),1);

  if tg_table_name='ph_orders_history' then
    new.row_state_hash:=private.orders_history_state_hash_v2366(new);
    select row.order_line_key into existing_key from public.ph_orders_history row
    where row.itemcode=new.itemcode and row.row_state_hash=new.row_state_hash
      and row.order_line_key<>new.order_line_key order by row.first_seen_at,row.order_line_key limit 1;
    if existing_key is not null then
      update public.ph_orders_history row set last_seen_at=greatest(row.last_seen_at,new.last_seen_at),
        last_file_id=coalesce(new.last_file_id,row.last_file_id),last_file_name=coalesce(new.last_file_name,row.last_file_name),
        seen_count=row.seen_count+case when coalesce(row.last_file_id,row.last_file_name,'')
          is distinct from coalesce(new.last_file_id,new.last_file_name,'') then new.seen_count else 0 end,
        updated_at=greatest(row.updated_at,new.updated_at) where row.order_line_key=existing_key;
    end if;
  elsif tg_table_name='ph_reserves_history' then
    new.row_state_hash:=private.reserves_history_state_hash_v2366(new);
    select row.reserve_history_key into existing_key from public.ph_reserves_history row
    where row.itemcode=new.itemcode and row.row_state_hash=new.row_state_hash
      and row.reserve_history_key<>new.reserve_history_key order by row.first_seen_at,row.reserve_history_key limit 1;
    if existing_key is not null then
      update public.ph_reserves_history row set last_seen_at=greatest(row.last_seen_at,new.last_seen_at),
        last_file_id=coalesce(new.last_file_id,row.last_file_id),last_file_name=coalesce(new.last_file_name,row.last_file_name),
        seen_count=row.seen_count+case when coalesce(row.last_file_id,row.last_file_name,'')
          is distinct from coalesce(new.last_file_id,new.last_file_name,'') then new.seen_count else 0 end,
        updated_at=greatest(row.updated_at,new.updated_at) where row.reserve_history_key=existing_key;
    end if;
  else
    new.available:=coalesce(new.available,new.ptravailable);
    new.row_state_hash:=private.drive_mode_history_state_hash_v2366(new);
    if tg_op='UPDATE' and (new.itemcode,new.row_state_hash) is not distinct from (old.itemcode,old.row_state_hash) then return new; end if;
    if new.itemcode is null then
      select row.history_key into existing_key from public.ph_drive_mode_history row where row.itemcode is null and row.row_state_hash=new.row_state_hash and row.history_key<>new.history_key order by row.first_seen_at,row.history_key limit 1;
    else
      select row.history_key into existing_key from public.ph_drive_mode_history row where row.itemcode=new.itemcode and row.row_state_hash=new.row_state_hash and row.history_key<>new.history_key order by row.first_seen_at,row.history_key limit 1;
    end if;
    if existing_key is not null then
      update public.ph_drive_mode_history row set last_seen_at=greatest(row.last_seen_at,new.last_seen_at),
        last_file_id=coalesce(new.last_file_id,row.last_file_id),last_file_name=coalesce(new.last_file_name,row.last_file_name),
        seen_count=row.seen_count+case when coalesce(row.last_file_id,row.last_file_name,'')
          is distinct from coalesce(new.last_file_id,new.last_file_name,'') then new.seen_count else 0 end,
        updated_at=greatest(row.updated_at,new.updated_at) where row.history_key=existing_key;
    end if;
  end if;
  if existing_key is null then return new; end if;
  if tg_op='UPDATE' then return old; end if;
  return null;
end
$function$
