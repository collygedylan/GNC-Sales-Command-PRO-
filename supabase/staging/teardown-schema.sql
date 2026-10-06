-- Isolated staging resources only. Never apply this file to production.
begin;
create schema if not exists teardown;
create schema if not exists teardown_private;
revoke all on schema teardown, teardown_private from public, anon;
grant usage on schema teardown to authenticated, service_role;
grant usage on schema teardown_private to authenticated, service_role;

create table if not exists teardown_private.members (
  user_id uuid primary key references auth.users(id),
  username text not null unique,
  display_name text not null,
  active boolean not null default true
);
create table if not exists teardown.rows (
  collection text not null check (collection in ('inventory', 'requests')),
  id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create table if not exists teardown_private.commands (
  actor uuid not null references auth.users(id),
  request_id uuid not null,
  body jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor, request_id)
);
create table if not exists teardown_private.deliveries (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null references auth.users(id),
  request_id uuid not null,
  channel text not null check (channel in ('email', 'push')),
  command jsonb not null,
  snapshot jsonb not null,
  state text not null default 'captured' check (state = 'captured'),
  created_at timestamptz not null default now(),
  unique (actor, request_id)
);
alter table teardown_private.members enable row level security;
alter table teardown.rows enable row level security;
alter table teardown_private.commands enable row level security;
alter table teardown_private.deliveries enable row level security;
revoke all on all tables in schema teardown_private from public, anon, authenticated;
grant all on all tables in schema teardown_private to service_role;
revoke all on teardown.rows from public, anon, authenticated;
grant select on teardown.rows to authenticated;
grant all on teardown.rows to service_role;

create or replace function teardown_private.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from teardown_private.members m
    where m.user_id = auth.uid() and m.active
    and exists (select 1 from auth.sessions s where s.user_id = m.user_id
      and s.id = nullif(auth.jwt()->>'session_id', '')::uuid));
$$;
revoke all on function teardown_private.is_member() from public, anon;
grant execute on function teardown_private.is_member() to authenticated, service_role;
drop policy if exists teardown_member_read on teardown.rows;
create policy teardown_member_read on teardown.rows for select to authenticated using (teardown_private.is_member());

create or replace function teardown_private.bootstrap()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare member teardown_private.members; result jsonb;
begin
  if not teardown_private.is_member() then raise exception 'TEARDOWN_ACCESS_DENIED' using errcode = '42501'; end if;
  select * into strict member from teardown_private.members where user_id = auth.uid();
  select jsonb_build_object(
    'profile', jsonb_build_object('id', member.user_id, 'username', member.username,
      'full_name', member.display_name, 'display_name', member.display_name, 'role', 'Admin',
      'division', 'PH', 'is_active', true, 'active', true, 'language', 'English',
      'email', member.username || '@teardown.example.invalid'),
    'request_capabilities', jsonb_build_object('contract_version', 2, 'username', member.username,
      'scope', 'global', 'can_create_general', false, 'can_create_av', false,
      'can_view_queue', true, 'can_take_photo', true, 'can_edit', true,
      'can_complete', true, 'can_archive', false),
    'app_access', jsonb_build_object('contract_version', 'app-access-v1',
      'enforcement_mode', 'enforced', 'username', member.username, 'role', 'Admin',
      'policy_version', 1, 'policy_revision', 1, 'data_permission_version', 'teardown-v1',
      'permissions', jsonb_build_array(jsonb_build_object('permission_key', 'module.request.view',
        'permission_kind', 'module', 'module_key', 'request', 'label', 'Synthetic requests',
        'allowed', true, 'scope', 'global', 'source', 'teardown-membership'),
        jsonb_build_object('permission_key', 'module.drive.view', 'permission_kind', 'module',
          'module_key', 'drive', 'label', 'Synthetic inventory', 'allowed', true,
          'scope', 'global', 'source', 'teardown-membership'))),
    'inventory', coalesce((select jsonb_agg(data || jsonb_build_object('unique_id', id,
      'id', id, '_staging_revision', revision, 'last_updated', updated_at) order by id)
      from teardown.rows where collection = 'inventory'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(data || jsonb_build_object('unique_id', id,
      'id', id, '_staging_revision', revision, 'last_updated', updated_at) order by id)
      from teardown.rows where collection = 'requests'), '[]'::jsonb),
    'deliveries', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'channel', channel,
      'state', state, 'created_at', created_at) order by created_at desc)
      from teardown_private.deliveries where actor = auth.uid()), '[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function teardown_private.save_row(command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_request uuid := (command->>'requestId')::uuid;
  prior teardown_private.commands; current_row teardown.rows; patch jsonb := command->'patch'; result jsonb;
begin
  if not teardown_private.is_member() then raise exception 'TEARDOWN_ACCESS_DENIED' using errcode = '42501'; end if;
  if v_request is null or patch is null or jsonb_typeof(patch) <> 'object' or coalesce((command->>'expectedRevision')::bigint, 0) < 1 then raise exception 'TEARDOWN_INVALID_COMMAND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || v_request::text, 0));
  select * into prior from teardown_private.commands
    where commands.actor = v_actor and commands.request_id = v_request;
  if found then
    if prior.body <> command then raise exception 'TEARDOWN_REQUEST_ID_REUSED'; end if;
    return prior.result;
  end if;
  if exists (select 1 from jsonb_object_keys(patch) as patch_field(key) where patch_field.key not in
    ('note','notes','dock_spec','dockspec','caliper','av_note','avnote','locationcode',
     'quantity','ptravailable','completed','match_percent','match_quantity','initial_ptr')) then
    raise exception 'TEARDOWN_FIELD_FORBIDDEN' using errcode = '42501';
  end if;
  select * into current_row from teardown.rows where collection = command->>'collection' and id = command->>'id' for update;
  if not found then raise exception 'TEARDOWN_ROW_NOT_FOUND'; end if;
  if current_row.revision <> (command->>'expectedRevision')::bigint then raise exception 'TEARDOWN_REVISION_CONFLICT' using errcode = '40001'; end if;
  if patch ? 'completed' then
    patch := patch || jsonb_build_object('completed_by', v_actor, 'completed_at', clock_timestamp());
  end if;
  update teardown.rows set data = data || patch, revision = revision + 1, updated_at = clock_timestamp()
    where collection = current_row.collection and id = current_row.id returning * into current_row;
  result := jsonb_build_object('row', current_row.data || jsonb_build_object('unique_id', current_row.id,
    'id', current_row.id, '_staging_revision', current_row.revision, 'last_updated', current_row.updated_at), 'revision', current_row.revision);
  insert into teardown_private.commands values (v_actor, v_request, command, result, now());
  return result;
end $$;

create or replace function teardown_private.capture_delivery(command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_request uuid := (command->>'requestId')::uuid;
  prior teardown_private.deliveries; snapshot jsonb;
begin
  if not teardown_private.is_member() then raise exception 'TEARDOWN_ACCESS_DENIED' using errcode = '42501'; end if;
  if v_request is null or command->>'channel' not in ('email','push') then raise exception 'TEARDOWN_INVALID_CHANNEL'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || v_request::text, 1));
  select * into prior from teardown_private.deliveries
    where deliveries.actor = v_actor and deliveries.request_id = v_request;
  if found then
    if prior.command <> command then raise exception 'TEARDOWN_REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('id', prior.id, 'state', 'captured', 'channel', prior.channel);
  end if;
  select data || jsonb_build_object('unique_id', id, 'revision', revision, 'collection', collection) into snapshot from teardown.rows
    where id = command->>'rowId' and collection = coalesce(command->>'collection', 'requests');
  if snapshot is null then raise exception 'TEARDOWN_ROW_NOT_FOUND'; end if;
  insert into teardown_private.deliveries(actor, request_id, channel, command, snapshot)
    values (v_actor, v_request, command->>'channel', command, snapshot) returning * into prior;
  return jsonb_build_object('id', prior.id, 'state', 'captured', 'channel', prior.channel);
end $$;

create or replace function teardown_private.commit_photo(command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_request uuid := (command->>'requestId')::uuid;
  current_row teardown.rows; prior teardown_private.commands; result jsonb; photo jsonb := command->'photo';
begin
  if not teardown_private.is_member() then raise exception 'TEARDOWN_ACCESS_DENIED' using errcode = '42501'; end if;
  if v_request is null or coalesce((command->>'expectedRevision')::bigint, 0) < 1
    or not starts_with(coalesce(photo->>'path',''), v_actor::text || '/' || (command->>'rowId') || '/')
    or coalesce(photo->>'bucket','') <> 'teardown-photos'
    or coalesce(photo->>'contentType','') not in ('image/jpeg','image/png','image/webp')
    then raise exception 'TEARDOWN_PHOTO_FORBIDDEN'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'teardown-photos' and name = photo->>'path') then raise exception 'TEARDOWN_PHOTO_NOT_UPLOADED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || v_request::text, 0));
  select * into prior from teardown_private.commands
    where commands.actor = v_actor and commands.request_id = v_request;
  if found then
    if prior.body <> command then raise exception 'TEARDOWN_REQUEST_ID_REUSED'; end if;
    return prior.result;
  end if;
  select * into current_row from teardown.rows where id = command->>'rowId' and collection = coalesce(command->>'collection','inventory') for update;
  if not found then raise exception 'TEARDOWN_ROW_NOT_FOUND'; end if;
  if current_row.revision <> (command->>'expectedRevision')::bigint then raise exception 'TEARDOWN_REVISION_CONFLICT' using errcode = '40001'; end if;
  update teardown.rows set data = jsonb_set(data, '{photos}', coalesce(data->'photos','[]'::jsonb) || jsonb_build_array(photo)),
    revision = revision + 1, updated_at = clock_timestamp()
    where collection = current_row.collection and id = current_row.id returning * into current_row;
  result := jsonb_build_object('row', current_row.data || jsonb_build_object('unique_id', current_row.id,
    'id', current_row.id, '_staging_revision', current_row.revision, 'last_updated', current_row.updated_at), 'revision', current_row.revision);
  insert into teardown_private.commands values (v_actor, v_request, command, result, now());
  return result;
end $$;

revoke all on all functions in schema teardown_private from public, anon;
grant execute on function teardown_private.is_member(), teardown_private.bootstrap(),
  teardown_private.save_row(jsonb), teardown_private.capture_delivery(jsonb), teardown_private.commit_photo(jsonb)
  to authenticated, service_role;
-- Named invoker entrypoints avoid changing this shared project's exposed schemas.
create or replace function public.teardown_is_member() returns boolean language sql security invoker
  set search_path = '' as 'select teardown_private.is_member()';
create or replace function public.teardown_bootstrap() returns jsonb language sql security invoker
  set search_path = '' as 'select teardown_private.bootstrap()';
create or replace function public.teardown_save_row(command jsonb) returns jsonb language sql security invoker
  set search_path = '' as 'select teardown_private.save_row(command)';
create or replace function public.teardown_capture_delivery(command jsonb) returns jsonb language sql security invoker
  set search_path = '' as 'select teardown_private.capture_delivery(command)';
create or replace function public.teardown_commit_photo(command jsonb) returns jsonb language sql security invoker
  set search_path = '' as 'select teardown_private.commit_photo(command)';
revoke all on function public.teardown_is_member(), public.teardown_bootstrap(), public.teardown_save_row(jsonb),
  public.teardown_capture_delivery(jsonb), public.teardown_commit_photo(jsonb) from public, anon;
grant execute on function public.teardown_is_member(), public.teardown_bootstrap(), public.teardown_save_row(jsonb),
  public.teardown_capture_delivery(jsonb), public.teardown_commit_photo(jsonb) to authenticated, service_role;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('teardown-photos','teardown-photos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'teardown-photos' and not public
    and file_size_limit = 10485760 and allowed_mime_types = array['image/jpeg','image/png','image/webp']) then
    raise exception 'TEARDOWN_BUCKET_CONFIGURATION_MISMATCH';
  end if;
end $$;

insert into teardown.rows(collection,id,data) values
('inventory','staging-inventory-001','{"unique_id":"staging-inventory-001","itemcode":"STAGING-001","commonname":"GNC Staging Red Maple","contsize":"#3","locationcode":"E.99.001","season":"F1","saleyear":"27","salesyear":"27","warehouseid":"10","warehousei":"10","ptravailable":"25","ptronhand":"25","lotcode":"27.F1","note":"Synthetic inventory for staging review","photos":[]}'),
('requests','staging-request-001','{"unique_id":"staging-request-001","itemcode":"STAGING-001","commonname":"GNC Staging Red Maple","contsize":"#3","locationcode":"E.99.001","qty":"4","quantityordered":"4","customername":"GNC Staging Test Customer","consigneename":"GNC Staging Test Customer","completed":false,"assignedto":"dylan_collyge","request_source":"Request","note":"Synthetic request for staging review","photos":[]}')
on conflict (collection,id) do nothing;
commit;
