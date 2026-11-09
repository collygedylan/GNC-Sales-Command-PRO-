begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function private.history_business_state_v3039(p_row jsonb)
returns jsonb language sql immutable set search_path='' as $function$
  select p_row-array['history_key','order_line_key','reserve_history_key','unique_id',
    'source_unique_id','source_file_id','source_file_name','file_id','file_name','report_date',
    'row_number','row_hash','row_state_hash','created_at','updated_at','archived_at','search_text',
    'first_seen_at','last_seen_at','first_file_id','last_file_id','first_file_name','last_file_name',
    'last_report_date','seen_count']::text[]
$function$;

-- These three writers do not publish an independently count-verified logical
-- cohort. Initialize metadata through the existing trigger and retain each row.
create or replace function private.merge_compact_history_state_v2366()
returns trigger language plpgsql security definer set search_path='' as $function$
declare observed_at timestamptz:=coalesce(new.archived_at,new.updated_at,clock_timestamp());
begin
  if tg_op='UPDATE' then return new; end if;
  new.first_seen_at:=coalesce(new.first_seen_at,observed_at);
  new.last_seen_at:=coalesce(new.last_seen_at,observed_at);
  new.first_file_id:=coalesce(new.first_file_id,new.source_file_id,new.source_unique_id);
  new.last_file_id:=coalesce(new.last_file_id,new.first_file_id);
  new.first_file_name:=coalesce(new.first_file_name,new.source_file_name,new.first_file_id);
  new.last_file_name:=coalesce(new.last_file_name,new.first_file_name);
  new.seen_count:=greatest(coalesce(new.seen_count,1),1);
  new.row_state_hash:=md5(private.history_business_state_v3039(to_jsonb(new))::text);
  return new;
end
$function$;

revoke all on function private.history_business_state_v3039(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.merge_compact_history_state_v2366() from public,anon,authenticated,service_role;

-- Pause only the installed global-hash job whose deduplication erases reversions.
do $pause_unsafe_legacy_job$
begin
  if to_regclass('cron.job') is not null then
    if exists(select 1 from cron.job where jobid=56
      and jobname='agdata_historical_state_dedup_v2366'
      and command='select private.run_historical_state_dedup_v2366();' and active) then
      perform cron.alter_job(56,active:=false);
    end if;
  end if;
end
$pause_unsafe_legacy_job$;

commit;
