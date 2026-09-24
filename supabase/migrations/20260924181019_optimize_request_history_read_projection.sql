begin;

-- Definition-only read optimization. Do not backfill history or enqueue delivery.
-- Validate actor and module access once; defer per-record credit projection until
-- after complete authorized search and pagination. Folder reads need no credits.
create or replace function public.request_history_command_v1(
  p_actor_id uuid,p_operation text,p_payload jsonb default '{}',
  p_command_id uuid default null,p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.profiles;
  result jsonb;
  rep_scoped boolean;
  actor_key text;
  credit_allowed boolean := false;
  lim integer:=least(100,greatest(1,coalesce((p_payload->>'limit')::integer,40)));
  q text:=sales_private.key(p_payload->>'query');
  status text:=coalesce(p_payload->>'status','all');
  cursor_at timestamptz:=private.try_timestamptz(p_payload#>>'{cursor,at}');
  cursor_id text:=coalesce(p_payload#>>'{cursor,id}','');
begin
  actor:=sales_private.actor(p_actor_id);
  if p_operation='compatibility' then
    if not (public.navigation_module_allowed_v1(actor.id,'request-history')
      or public.navigation_module_allowed_v1(actor.id,'reports')
      or (public.navigation_module_allowed_v1(actor.id,'request') and private.navigation_legacy_allowed_v1(actor.id,'request')))
      then return jsonb_build_object('rows','[]'::jsonb,'nextCursor',null); end if;
  else
    perform sales_private.require_module(actor.id,'request-history');
  end if;
  if p_operation not in ('search','folders','detail','compatibility') or status not in ('completed','pending','all') then
    raise exception 'HISTORY_OPERATION_INVALID';
  end if;
  -- Equivalent to can_read_source for the already validated active actor.
  rep_scoped:=sales_private.is_rep(actor.role) or actor.username in ('ben_brown','chance_alldredge');
  actor_key:=sales_private.key(actor.username);
  if p_operation is distinct from 'folders' then
    credit_allowed:=public.navigation_module_allowed_v1(actor.id,'sales-credit');
  end if;

  with source as materialized (
    select coalesce(h.snapshot,'{}')||to_jsonb(h) row,h.assigned_rep_id rep
    from public.ph_request_history h
    union all
    select to_jsonb(a),sales_private.assigned_rep(to_jsonb(a)) from public.ph_active_request a
    where not exists(select 1 from public.ph_request_history h where h.unique_id=a.unique_id)
  ), normalized as (
    select row||jsonb_build_object(
      'customerKey',sales_private.customer_key(row),
      'customername',coalesce(nullif(row->>'customername',''),row->>'req_customer',row->>'request_customer','Unknown customer'),
      'consigneename',coalesce(nullif(row->>'consigneename',''),'Unknown consignee'),
      'assigned_rep_id',rep,
      'status',case when lower(row->>'req_status') in ('complete','completed') then 'completed' else 'pending' end
    ) row,
    coalesce(case when lower(row->>'req_status') in ('complete','completed')
      then private.try_timestamptz(row->>'date_completed') end,
      private.try_timestamptz(row->>'created_at'),'epoch'::timestamptz) sort_at
    from source
    where not rep_scoped or rep=actor.id or sales_private.key(row->>'request_created_by_username')=actor_key
  ), filtered as materialized (
    select row||jsonb_build_object('sort_at',sort_at) row,sort_at from normalized
    where (status='all' or row->>'status'=status)
      and (q='' or position(q in sales_private.key(concat_ws(' ',row->>'customername',row->>'consigneename',row->>'commonname',row->>'itemcode',row->>'request_folder')))>0)
      and (nullif(p_payload->>'customerKey','') is null or row->>'customerKey'=p_payload->>'customerKey')
      and (p_operation<>'detail' or row->>'unique_id'=p_payload->>'id')
  ), page as materialized (
    select * from filtered where cursor_at is null or (sort_at,row->>'unique_id')<(cursor_at,cursor_id)
    order by sort_at desc,row->>'unique_id' desc limit lim+1
  ), folders as (
    select row->>'customerKey' key,max(row->>'customername') customer,
      max(row->>'consigneename') consignee,count(*) count from filtered
    group by row->>'customerKey'
    having coalesce(p_payload#>>'{cursor,key}','')='' or row->>'customerKey'>p_payload#>>'{cursor,key}'
    order by row->>'customerKey' limit lim+1
  )
  select case when p_operation='folders' then
    jsonb_build_object('folders',coalesce((select jsonb_agg(jsonb_build_object('customerKey',key,
      'customername',customer,'consigneename',consignee,'count',count) order by key)
      from (select * from folders limit lim) f),'[]'::jsonb),
      'nextCursor',case when (select count(*) from folders)>lim
        then (select jsonb_build_object('key',key) from folders offset lim-1 limit 1) end)
  else
    jsonb_build_object('rows',coalesce((select jsonb_agg(r.row||jsonb_build_object(
      'canRequestCredit',coalesce(credit_allowed,false) and exists(
        select 1 from public.ph_credit_sources cs
        where cs.source_kind='request_history' and cs.source_id=r.row->>'unique_id'
          and (not rep_scoped or cs.assigned_rep_id=actor.id)
          and (cs.canonical_source_id is null or exists(
            select 1 from public.ph_credit_sources canonical where canonical.id=cs.canonical_source_id
              and canonical.canonical_source_id is null
              and (not rep_scoped or canonical.assigned_rep_id=actor.id)
          ))
      )) order by r.sort_at desc,r.row->>'unique_id' desc)
      from (select * from page order by sort_at desc,row->>'unique_id' desc limit lim) r),'[]'::jsonb),
      'nextCursor',case when (select count(*) from page)>lim
        then (select jsonb_build_object('at',sort_at,'id',row->>'unique_id')
          from page order by sort_at desc,row->>'unique_id' desc offset lim-1 limit 1) end)
  end into result;
  return result;
end $$;

revoke all on function public.request_history_command_v1(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.request_history_command_v1(uuid,text,jsonb,uuid,bigint) to service_role;
comment on function public.request_history_command_v1(uuid,text,jsonb,uuid,bigint) is
  'Service-only rep/creator-scoped history. Full permitted search precedes paging; actor checks run once and credit projection runs only on returned rows.';
commit;
