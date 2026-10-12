begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Server-managed flags: profiles and browser metadata cannot opt into AURA.
create table private.aura_account_rollout (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false
);
revoke all on private.aura_account_rollout from public,anon,authenticated;
grant select,insert,update,delete on private.aura_account_rollout to service_role;
do $$ begin
  if (select count(*) from public.profiles where lower(btrim(username))='dylan_collyge')>1 then
    raise exception 'AURA_ROLLOUT_OWNER_AMBIGUOUS';
  end if;
end $$;
insert into private.aura_account_rollout(profile_id,enabled)
select id,true from public.profiles where lower(btrim(username))='dylan_collyge';
alter table private.aura_account_rollout enable row level security;
alter table private.aura_account_rollout force row level security;
create policy aura_rollout_owner on private.aura_account_rollout to postgres
  using (true) with check (true);
create policy aura_rollout_service on private.aura_account_rollout to service_role
  using (true) with check (true);

-- Preserve role, account-state and module authorization inside the existing RPC.
do $$
declare definition text;
  old_gate text:='if actor_id is null then';
  old_capabilities text:=$old$'capabilities',jsonb_build_object('inventory'$old$;
begin
  definition:=pg_get_functiondef('public.aura_voice_access_v1()'::regprocedure);
  if length(definition)-length(replace(definition,old_gate,''))<>length(old_gate)
    or length(definition)-length(replace(definition,old_capabilities,''))<>length(old_capabilities) then
    raise exception 'AURA_ROLLOUT_ACCESS_CONTRACT_MISMATCH';
  end if;
  definition:=replace(definition,old_gate,
    'if actor_id is null or not exists(select 1 from private.aura_account_rollout r where r.profile_id=actor_id and r.enabled) then');
  definition:=replace(definition,old_capabilities,$new$'capabilities',jsonb_build_object('auraEnabled',true,'inventory'$new$);
  execute definition;
end $$;
commit;
