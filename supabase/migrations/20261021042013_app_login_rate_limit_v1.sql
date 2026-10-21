begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table private.app_login_rate_limits_v1 (
  scope text not null check (scope in ('username','ip')),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  failed_count integer not null check (failed_count > 0),
  primary key (scope,digest)
);
create index app_login_rate_limits_v1_expiry_idx on private.app_login_rate_limits_v1(window_started_at);
alter table private.app_login_rate_limits_v1 enable row level security;
revoke all on private.app_login_rate_limits_v1 from public,anon,authenticated,service_role;

create or replace function private.app_login_rate_limit_v1(
  p_operation text,
  p_username_digest text,
  p_ip_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_value timestamptz := statement_timestamp();
  username_count integer := 0;
  ip_count integer := 0;
  username_start timestamptz;
  ip_start timestamptz;
  retry_seconds integer := 0;
begin
  if coalesce(p_operation,'') not in ('check','failure','success')
    or p_username_digest is null or p_username_digest !~ '^[0-9a-f]{64}$'
    or p_ip_digest is null or p_ip_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='APP_LOGIN_RATE_LIMIT_REQUEST_INVALID';
  end if;

  if p_operation='failure' then
    if random()<0.05 then
      delete from private.app_login_rate_limits_v1 where window_started_at <= now_value-interval '1 day';
    end if;
    insert into private.app_login_rate_limits_v1(scope,digest,window_started_at,failed_count)
      values('username',p_username_digest,now_value,1)
    on conflict(scope,digest) do update set
      failed_count=case when private.app_login_rate_limits_v1.window_started_at <= now_value-interval '15 minutes'
        then 1 else private.app_login_rate_limits_v1.failed_count+1 end,
      window_started_at=case when private.app_login_rate_limits_v1.window_started_at <= now_value-interval '15 minutes'
        then now_value else private.app_login_rate_limits_v1.window_started_at end;
    insert into private.app_login_rate_limits_v1(scope,digest,window_started_at,failed_count)
      values('ip',p_ip_digest,now_value,1)
    on conflict(scope,digest) do update set
      failed_count=case when private.app_login_rate_limits_v1.window_started_at <= now_value-interval '15 minutes'
        then 1 else private.app_login_rate_limits_v1.failed_count+1 end,
      window_started_at=case when private.app_login_rate_limits_v1.window_started_at <= now_value-interval '15 minutes'
        then now_value else private.app_login_rate_limits_v1.window_started_at end;
  elsif p_operation='success' then
    delete from private.app_login_rate_limits_v1 where scope='username' and digest=p_username_digest;
  end if;

  select failed_count,window_started_at into username_count,username_start
    from private.app_login_rate_limits_v1 where scope='username' and digest=p_username_digest
      and window_started_at > now_value-interval '15 minutes';
  select failed_count,window_started_at into ip_count,ip_start
    from private.app_login_rate_limits_v1 where scope='ip' and digest=p_ip_digest
      and window_started_at > now_value-interval '15 minutes';
  if p_operation='check' and (coalesce(username_count,0)>=10 or coalesce(ip_count,0)>=40) then
    retry_seconds:=greatest(1,ceil(extract(epoch from (
      (case when coalesce(username_count,0)>=10 then username_start else ip_start end)
      + interval '15 minutes' - now_value)))::integer);
    return jsonb_build_object('allowed',false,'retry_after_seconds',retry_seconds);
  end if;
  return jsonb_build_object('allowed',true,'retry_after_seconds',0);
end
$$;
revoke all on function private.app_login_rate_limit_v1(text,text,text) from public,anon,authenticated;
grant execute on function private.app_login_rate_limit_v1(text,text,text) to service_role;

-- PostgREST's default RPC schema is public. Keep storage and implementation
-- private while exposing only this service-role-gated forwarding function.
create or replace function public.app_login_rate_limit_v1(
  p_operation text,
  p_username_digest text,
  p_ip_digest text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.app_login_rate_limit_v1(p_operation,p_username_digest,p_ip_digest)
$$;
revoke all on function public.app_login_rate_limit_v1(text,text,text) from public,anon,authenticated;
grant execute on function public.app_login_rate_limit_v1(text,text,text) to service_role;

commit;
