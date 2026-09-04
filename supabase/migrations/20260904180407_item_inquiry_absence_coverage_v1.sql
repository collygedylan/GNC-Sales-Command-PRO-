begin;

insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order, active)
values ('managers.item_inquiry_coverage.manage', 'action', 'managers', 'Manage Item Inquiry coverage',
  'Mark Sharon Here or Gone. Sunday is copied on new Item Inquiries while Sharon is gone.',
  array['global']::text[], 615, true)
on conflict (permission_key) do nothing;

insert into private.app_access_role_grants (policy_id, role_key, permission_key, allowed, access_scope)
select v.id, r.role_key, 'managers.item_inquiry_coverage.manage', true, 'global'
from private.app_access_policy_versions v
cross join (values ('ADMIN'), ('ADMINISTRATOR'), ('MANAGER')) r(role_key)
on conflict (policy_id, role_key, permission_key) do nothing;

create or replace function private.can_manage_item_inquiry_coverage_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password
      and private.normalized_profile_role(p.role) in ('ADMIN','ADMINISTRATOR','MANAGER')
      and exists (select 1 from private.get_effective_app_permissions_v1(
        p.id, private.resolve_app_access_policy_id_v1(false)) e
        where e.permission_key = 'module.managers.view' and e.allowed)
      and exists (select 1 from private.get_effective_app_permissions_v1(
        p.id, private.resolve_app_access_policy_id_v1(false)) e
        where e.permission_key = 'managers.item_inquiry_coverage.manage' and e.allowed)
  )
$$;
revoke all on function private.can_manage_item_inquiry_coverage_v1() from public, anon;
grant execute on function private.can_manage_item_inquiry_coverage_v1() to authenticated, service_role;

create table public.ph_item_inquiry_coverage (
  singleton boolean primary key default true check(singleton),
  sharon_away boolean not null default false,
  revision bigint not null default 1 check(revision > 0),
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.ph_item_inquiry_coverage(singleton) values(true);
alter table public.ph_item_inquiry_coverage enable row level security;
revoke all on public.ph_item_inquiry_coverage from public, anon, authenticated;
grant select on public.ph_item_inquiry_coverage to authenticated;
grant all on public.ph_item_inquiry_coverage to service_role;
create policy item_inquiry_coverage_manager_read on public.ph_item_inquiry_coverage
for select to authenticated using ((select private.can_manage_item_inquiry_coverage_v1()));

create table private.item_inquiry_coverage_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  idempotency_key text not null,
  requested_away boolean not null,
  expected_revision bigint not null,
  previous_away boolean not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(actor_id, idempotency_key)
);
alter table private.item_inquiry_coverage_audit enable row level security;
revoke all on private.item_inquiry_coverage_audit from public, anon, authenticated;
grant select on private.item_inquiry_coverage_audit to service_role;

create or replace function private.item_inquiry_verified_email_v1(p_username text)
returns text language sql stable security definer set search_path = '' as $$
  select lower(btrim(u.email)) from public.profiles p join auth.users u on u.id=p.id
  where lower(btrim(p.username))=p_username and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password
    and u.email_confirmed_at is not null
    and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  order by p.id limit 1
$$;
revoke all on function private.item_inquiry_verified_email_v1(text) from public, anon, authenticated;
grant execute on function private.item_inquiry_verified_email_v1(text) to service_role;

create or replace function private.item_inquiry_coverage_operation_v1(
  p_away boolean default null, p_expected_revision bigint default null, p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  actor_username text;
  s public.ph_item_inquiry_coverage;
  saved private.item_inquiry_coverage_audit;
  result jsonb;
  previous_away boolean;
begin
  if not private.can_manage_item_inquiry_coverage_v1() then
    raise exception using errcode='42501',message='ITEM_INQUIRY_COVERAGE_FORBIDDEN';
  end if;
  if p_away is not null then
    if p_expected_revision is null or p_expected_revision < 1
      or length(coalesce(p_idempotency_key,'')) not between 12 and 180 then
      raise exception using errcode='22023',message='ITEM_INQUIRY_COVERAGE_INVALID';
    end if;
    select * into s from public.ph_item_inquiry_coverage where singleton for update;
    select * into saved from private.item_inquiry_coverage_audit
      where item_inquiry_coverage_audit.actor_id=v_actor_id
        and item_inquiry_coverage_audit.idempotency_key=p_idempotency_key;
    if saved.id is not null then
      if saved.requested_away is distinct from p_away or saved.expected_revision <> p_expected_revision then
        raise exception using errcode='22023',message='ITEM_INQUIRY_COVERAGE_TOKEN_CONFLICT';
      end if;
      return saved.result || jsonb_build_object('replayed',true);
    end if;
    if s.revision <> p_expected_revision then
      raise exception using errcode='40001',message='ITEM_INQUIRY_COVERAGE_STALE';
    end if;
    if p_away and private.item_inquiry_verified_email_v1('sunday_ellis') is null then
      raise exception using errcode='40001',message='ITEM_INQUIRY_COVERAGE_UNAVAILABLE';
    end if;
    previous_away := s.sharon_away;
    select lower(btrim(username)) into actor_username from public.profiles where id=v_actor_id;
    if s.sharon_away is distinct from p_away then
      update public.ph_item_inquiry_coverage set sharon_away=p_away, revision=revision+1,
        updated_by=actor_username,updated_at=now() where singleton returning * into s;
    end if;
  else
    select * into s from public.ph_item_inquiry_coverage where singleton;
  end if;
  result := jsonb_build_object('ok',true,'sharonAway',s.sharon_away,'revision',s.revision,
    'updatedBy',s.updated_by,'updatedAt',s.updated_at,
    'backupReady',private.item_inquiry_verified_email_v1('sunday_ellis') is not null);
  if p_away is not null then
    insert into private.item_inquiry_coverage_audit
      (actor_id,idempotency_key,requested_away,expected_revision,previous_away,result)
    values(v_actor_id,p_idempotency_key,p_away,p_expected_revision,previous_away,result);
  end if;
  return result;
end
$$;
revoke all on function private.item_inquiry_coverage_operation_v1(boolean,bigint,text) from public, anon;
grant execute on function private.item_inquiry_coverage_operation_v1(boolean,bigint,text) to authenticated;

create or replace function public.get_item_inquiry_coverage_v1()
returns jsonb language sql security invoker set search_path='' as $$
  select private.item_inquiry_coverage_operation_v1()
$$;
create or replace function public.set_item_inquiry_coverage_v1(
  p_away boolean,p_expected_revision bigint,p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_away is null then raise exception using errcode='22023',message='ITEM_INQUIRY_COVERAGE_INVALID'; end if;
  return private.item_inquiry_coverage_operation_v1(p_away,p_expected_revision,p_idempotency_key);
end
$$;
revoke all on function public.get_item_inquiry_coverage_v1() from public, anon;
revoke all on function public.set_item_inquiry_coverage_v1(boolean,bigint,text) from public, anon;
grant execute on function public.get_item_inquiry_coverage_v1() to authenticated;
grant execute on function public.set_item_inquiry_coverage_v1(boolean,bigint,text) to authenticated;

-- INSERT only: the coverage snapshot and recipients are immutable across retries.
-- Initial assignment, customer Request, photo-history and past email events are untouched.
create or replace function private.freeze_item_inquiry_coverage_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  s public.ph_item_inquiry_coverage;
  emails text[];
  sharon_email text;
  sunday_email text;
  applied boolean := false;
begin
  if new.event_type not in ('reclass_inquiry','eval_work_completion') then return new; end if;
  select * into s from public.ph_item_inquiry_coverage where singleton;
  select coalesce(array_agg(distinct lower(btrim(value)) order by lower(btrim(value))), '{}'::text[])
    into emails from jsonb_array_elements_text(case when new.event_type='reclass_inquiry'
      then coalesce(new.payload#>'{reclassPayload,recipientEmails}','[]'::jsonb)
      else coalesce(new.payload->'completionRecipients','[]'::jsonb) end)
    where btrim(value) <> '';
  sharon_email := private.item_inquiry_verified_email_v1('sharon_combs');
  if s.sharon_away and sharon_email=any(emails) then
    sunday_email := private.item_inquiry_verified_email_v1('sunday_ellis');
    if sunday_email is null then
      raise exception using errcode='40001',message='ITEM_INQUIRY_COVERAGE_UNAVAILABLE';
    end if;
    select array_agg(distinct value order by value) into emails from unnest(emails || sunday_email) value;
    applied := true;
  end if;
  if new.event_type='reclass_inquiry' then
    new.payload := jsonb_set(new.payload,'{reclassPayload,recipientEmails}',to_jsonb(emails));
    new.payload := jsonb_set(new.payload,'{reclassPayload,emailRecipients}',to_jsonb(emails));
    new.payload := jsonb_set(new.payload,'{reclassPayload,recipients}',(
      select coalesce(jsonb_agg(jsonb_build_object('email',email,'role','frozen_item_inquiry')),'[]'::jsonb)
      from unnest(emails) email));
  else
    new.payload := jsonb_set(new.payload,'{completionRecipients}',to_jsonb(emails));
  end if;
  new.payload := jsonb_set(new.payload,'{itemInquiryCoverage}',jsonb_build_object(
    'contractVersion','item-inquiry-coverage-v1','revision',s.revision,
    'sharonAway',s.sharon_away,'sundayAdded',applied));
  return new;
end
$$;
revoke all on function private.freeze_item_inquiry_coverage_v1() from public, anon, authenticated;
grant execute on function private.freeze_item_inquiry_coverage_v1() to service_role;
create trigger freeze_item_inquiry_coverage_v1 before insert on public.ph_request_delivery_outbox
for each row execute function private.freeze_item_inquiry_coverage_v1();

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.ph_item_inquiry_coverage;
  end if;
end $$;

insert into private.app_access_legacy_checks(check_key,permission_key,enforcement_surface,notes)
values ('rpc.item_inquiry.coverage.v1','managers.item_inquiry_coverage.manage','rpc',
  'Active manager role, Managers permission and coverage permission are all required; recipient routing is outbox-owned.')
on conflict(check_key) do nothing;
insert into private.app_access_legacy_baseline(profile_id,permission_key,allowed,access_scope)
select p.id,e.permission_key,e.allowed,e.access_scope from public.profiles p
cross join lateral private.get_effective_app_permissions_v1(p.id,private.resolve_app_access_policy_id_v1(true)) e
where e.permission_key='managers.item_inquiry_coverage.manage'
on conflict(profile_id,permission_key) do nothing;

notify pgrst,'reload schema';
commit;
