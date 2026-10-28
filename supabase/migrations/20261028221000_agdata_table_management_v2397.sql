begin;
set local lock_timeout = '5s';

insert into app_sync_private.sources(key,modules,client_enabled,dylan_only)
values ('ph_company_directory','{managers}',false,false),('ph_inquiry_coverage','{managers}',false,false)
on conflict(key) do nothing;

create table if not exists public.ph_company_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  username text,
  email text,
  phone text,
  userrole text,
  department text,
  territory text,
  active boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  updated_by text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (username is null or length(btrim(username)) between 1 and 80),
  check (email is null or length(btrim(email)) <= 254),
  check (phone is null or length(btrim(phone)) <= 64),
  check (userrole is null or length(btrim(userrole)) <= 64),
  check (department is null or length(btrim(department)) <= 120),
  check (territory is null or length(btrim(territory)) <= 120)
);
create unique index if not exists ph_company_directory_username_key
  on public.ph_company_directory(lower(btrim(username))) where nullif(btrim(username),'') is not null;
create index if not exists ph_company_directory_active_name_idx
  on public.ph_company_directory(active,lower(name));
insert into public.ph_company_directory(name,username,email,userrole,department,active)
select coalesce(nullif(btrim(profile.display_name),''),access.username),lower(btrim(access.username)),
  nullif(btrim(access.email),''),access.canonical_role,nullif(btrim(profile.division),''),
  access.active and profile.disabled_at is null
from public.user_access_control access
join public.profiles profile on profile.id=access.profile_id
where nullif(btrim(access.username),'') is not null
on conflict (lower(btrim(username))) where nullif(btrim(username),'') is not null do nothing;
alter table public.ph_company_directory enable row level security;
revoke all privileges on table public.ph_company_directory from public,anon,authenticated;
revoke all privileges on table public.ph_company_directory from service_role;

create table if not exists public.ph_inquiry_coverage (
  id uuid primary key default gen_random_uuid(),
  block text,
  location text,
  group_name text,
  scope text not null default 'location' check (scope in ('block','location','group','all')),
  primary_user text not null check (length(btrim(primary_user)) between 1 and 80),
  backup_user text,
  notes text,
  active boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  updated_by text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (block is null or length(btrim(block)) <= 120),
  check (location is null or length(btrim(location)) <= 120),
  check (group_name is null or length(btrim(group_name)) <= 120),
  check (backup_user is null or length(btrim(backup_user)) <= 80),
  check (notes is null or length(notes) <= 2000)
);
create index if not exists ph_inquiry_coverage_scope_idx
  on public.ph_inquiry_coverage(active,scope,lower(coalesce(location,block,group_name,'')));
alter table public.ph_inquiry_coverage enable row level security;
revoke all privileges on table public.ph_inquiry_coverage from public,anon,authenticated;
revoke all privileges on table public.ph_inquiry_coverage from service_role;

create table if not exists public.ph_manager_table_commands (
  command_id uuid primary key,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  table_name text not null,
  operation text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default statement_timestamp()
);
alter table public.ph_manager_table_commands enable row level security;
revoke all privileges on table public.ph_manager_table_commands from public,anon,authenticated;
revoke all privileges on table public.ph_manager_table_commands from service_role;

create or replace function private.touch_manager_table_revision_v2397()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dataset_key text;
begin
  dataset_key := case tg_table_name
    when 'ph_company_directory' then 'ph_company_directory'
    when 'ph_inquiry_coverage' then 'ph_inquiry_coverage'
    else null end;
  if dataset_key is not null then
    insert into public.app_dataset_revisions(key,revision,state,changed_at)
    values(dataset_key,1,'ready',statement_timestamp())
    on conflict(key) do update set revision=public.app_dataset_revisions.revision+1,
      state='ready',changed_at=statement_timestamp();
  end if;
  return coalesce(new,old);
end
$$;
revoke all on function private.touch_manager_table_revision_v2397() from public,anon,authenticated;
alter function private.touch_manager_table_revision_v2397() owner to postgres;
drop trigger if exists ph_company_directory_revision_v2397 on public.ph_company_directory;
create trigger ph_company_directory_revision_v2397 after insert or update or delete on public.ph_company_directory
  for each row execute function private.touch_manager_table_revision_v2397();
drop trigger if exists ph_inquiry_coverage_revision_v2397 on public.ph_inquiry_coverage;
create trigger ph_inquiry_coverage_revision_v2397 after insert or update or delete on public.ph_inquiry_coverage
  for each row execute function private.touch_manager_table_revision_v2397();

create or replace function public.manager_table_management_v2397(
  p_actor_id uuid,p_operation text,p_table text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles;
  row_value jsonb;
  row_id uuid;
  expected_revision bigint;
  page_number integer;
  page_size integer;
  query_text text;
  total_rows bigint;
  rows_value jsonb;
  users_value jsonb;
  company public.ph_company_directory;
  coverage public.ph_inquiry_coverage;
  safe_username text;
  v_command_id uuid;
  v_request_hash text;
  prior_hash text;
  prior_response jsonb;
  prior_actor uuid;
  prior_table text;
  prior_operation text;
  response_value jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='MANAGER_TABLE_SERVICE_ROLE_REQUIRED';
  end if;
  select * into actor from public.profiles where id=p_actor_id and disabled_at is null
    and not must_change_password and (locked_until is null or locked_until<=statement_timestamp());
  if actor.id is null or not private.user_access_has_permission_v1(p_actor_id,'can_access_manager_tab') then
    raise exception using errcode='42501',message='MANAGER_TABLE_ACCESS_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_payload,'{}'::jsonb)::text)>8192
    or p_table not in ('company-directory','inquiry-coverage','historical-drive-mode','historical-soc-open-orders',
      'historical-soc-reserves','historical-requests','photo-history') then
    raise exception using errcode='22023',message='MANAGER_TABLE_QUERY_INVALID';
  end if;
  if p_table in ('historical-drive-mode','historical-soc-open-orders','historical-soc-reserves','historical-requests','photo-history')
    and p_operation not in ('read','users') then
    raise exception using errcode='42501',message='MANAGER_TABLE_READ_ONLY';
  end if;
  if p_operation in ('create','update','delete') then
    begin v_command_id:=(p_payload->>'command_id')::uuid; exception when others then
      raise exception using errcode='22023',message='MANAGER_TABLE_COMMAND_ID_REQUIRED'; end;
    if v_command_id is null then raise exception using errcode='22023',message='MANAGER_TABLE_COMMAND_ID_REQUIRED'; end if;
    v_request_hash:=encode(extensions.digest((p_operation||':'||p_table||':'||(p_payload-'command_id')::text)::bytea,'sha256'),'hex');
    perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||v_command_id::text,791204));
    select command.request_hash,command.response,command.actor_profile_id,command.table_name,command.operation
      into prior_hash,prior_response,prior_actor,prior_table,prior_operation from public.ph_manager_table_commands command
      where command.command_id=v_command_id;
    if prior_response is not null then
      if prior_hash is distinct from v_request_hash
        or prior_actor is distinct from p_actor_id or prior_table is distinct from p_table or prior_operation is distinct from p_operation then
        raise exception using errcode='PT409',message='MANAGER_TABLE_COMMAND_CONFLICT';
      end if;
      return prior_response;
    end if;
  end if;
  if p_operation='users' then
    select coalesce(jsonb_agg(to_jsonb(user_row) order by lower(user_row.display_name),lower(user_row.username)),'[]'::jsonb)
      into users_value
      from (
        select distinct on (lower(btrim(source.username))) lower(btrim(source.username)) as username,
          coalesce(nullif(btrim(source.display_name),''),nullif(btrim(source.name),''),lower(btrim(source.username))) as display_name,
          nullif(btrim(source.email),'') as email,
          nullif(btrim(source.userrole),'') as userrole,
          nullif(btrim(source.territory),'') as territory
        from (
          select access.username,profile.display_name,null::text as name,access.email,access.canonical_role as userrole,
            directory.territory
          from public.user_access_control access
          join public.profiles profile on profile.id=access.profile_id and profile.disabled_at is null
            and not profile.must_change_password and (profile.locked_until is null or profile.locked_until<=statement_timestamp())
          left join public.ph_company_directory directory on lower(btrim(directory.username))=lower(btrim(access.username)) and directory.active
          where access.active
          union all
          select directory.username,null::text,directory.name,directory.email,directory.userrole,directory.territory
          from public.ph_company_directory directory where directory.active and nullif(btrim(directory.username),'') is not null
        ) source
        where nullif(btrim(source.username),'') is not null
        order by lower(btrim(source.username)),source.display_name nulls last
      ) user_row;
    return jsonb_build_object('ok',true,'rows',users_value);
  end if;
  if p_operation='read' then
    page_number:=greatest(0,least(coalesce((p_payload->>'page')::integer,0),10000));
    page_size:=greatest(1,least(coalesce((p_payload->>'pageSize')::integer,100),200));
    query_text:=left(btrim(coalesce(p_payload->>'q','')),120);
    if p_table='company-directory' then
      select count(*) into total_rows from public.ph_company_directory entry
      where query_text='' or concat_ws(' ',entry.name,entry.username,entry.email,entry.phone,entry.userrole,entry.department,entry.territory) ilike '%'||query_text||'%';
      select coalesce(jsonb_agg(to_jsonb(entry) order by lower(entry.name),entry.id),'[]'::jsonb) into rows_value
      from (select * from public.ph_company_directory entry
        where query_text='' or concat_ws(' ',entry.name,entry.username,entry.email,entry.phone,entry.userrole,entry.department,entry.territory) ilike '%'||query_text||'%'
        order by lower(entry.name),entry.id offset page_number*page_size limit page_size) entry;
    elsif p_table='inquiry-coverage' then
      select count(*) into total_rows from public.ph_inquiry_coverage entry
      where query_text='' or concat_ws(' ',entry.block,entry.location,entry.group_name,entry.scope,entry.primary_user,entry.backup_user,entry.notes) ilike '%'||query_text||'%';
      select coalesce(jsonb_agg(to_jsonb(entry) order by entry.scope,lower(coalesce(entry.location,entry.block,entry.group_name,'')),entry.id),'[]'::jsonb) into rows_value
      from (select * from public.ph_inquiry_coverage entry
        where query_text='' or concat_ws(' ',entry.block,entry.location,entry.group_name,entry.scope,entry.primary_user,entry.backup_user,entry.notes) ilike '%'||query_text||'%'
        order by entry.scope,lower(coalesce(entry.location,entry.block,entry.group_name,'')),entry.id offset page_number*page_size limit page_size) entry;
    else
      raise exception using errcode='22023',message='MANAGER_TABLE_READ_ONLY_SOURCE_REQUIRED';
    end if;
    return jsonb_build_object('ok',true,'rows',rows_value,'total',total_rows,'page',page_number,'pageSize',page_size);
  end if;
  if p_table not in ('company-directory','inquiry-coverage') or p_operation not in ('create','update','delete') then
    raise exception using errcode='42501',message='MANAGER_TABLE_OPERATION_FORBIDDEN';
  end if;
  if nullif(p_payload->>'id','') is not null then
    begin row_id:=(p_payload->>'id')::uuid; exception when others then raise exception using errcode='22023',message='MANAGER_TABLE_ID_INVALID'; end;
  end if;
  if p_operation in ('update','delete') then
    begin expected_revision:=(p_payload->>'expectedRevision')::bigint; exception when others then raise exception using errcode='22023',message='MANAGER_TABLE_REVISION_REQUIRED'; end;
    if expected_revision<1 then raise exception using errcode='22023',message='MANAGER_TABLE_REVISION_REQUIRED'; end if;
  end if;
  if p_table='company-directory' then
    if p_operation='delete' then
      delete from public.ph_company_directory where id=row_id and revision=expected_revision returning * into company;
      if company.id is null then raise exception using errcode='PT409',message='MANAGER_TABLE_ROW_CONFLICT'; end if;
      response_value:=jsonb_build_object('ok',true,'deletedId',row_id);
      insert into public.ph_manager_table_commands(command_id,actor_profile_id,table_name,operation,request_hash,response)
        values(v_command_id,p_actor_id,p_table,p_operation,v_request_hash,response_value);
      return response_value;
    end if;
    if p_payload ?| array['created_at','updated_at','updated_by','revision','access_code','permission_overrides']
      or (p_operation='create' and p_payload ? 'id') then
      raise exception using errcode='22023',message='MANAGER_TABLE_FIELDS_FORBIDDEN';
    end if;
    safe_username:=nullif(lower(btrim(p_payload->>'username')),'');
    if p_operation='create' then
      insert into public.ph_company_directory(name,username,email,phone,userrole,department,territory,active,updated_by)
      values(nullif(btrim(p_payload->>'name'),''),safe_username,nullif(btrim(p_payload->>'email'),''),nullif(btrim(p_payload->>'phone'),''),
        nullif(btrim(p_payload->>'userrole'),''),nullif(btrim(p_payload->>'department'),''),nullif(btrim(p_payload->>'territory'),''),
        coalesce((p_payload->>'active')::boolean,true),actor.username) returning * into company;
    else
      update public.ph_company_directory set name=coalesce(nullif(btrim(p_payload->>'name'),''),name),username=safe_username,
        email=nullif(btrim(p_payload->>'email'),''),phone=nullif(btrim(p_payload->>'phone'),''),userrole=nullif(btrim(p_payload->>'userrole'),''),
        department=nullif(btrim(p_payload->>'department'),''),territory=nullif(btrim(p_payload->>'territory'),''),
        active=coalesce((p_payload->>'active')::boolean,active),revision=revision+1,updated_by=actor.username,updated_at=statement_timestamp()
      where id=row_id and revision=expected_revision returning * into company;
      if company.id is null then raise exception using errcode='PT409',message='MANAGER_TABLE_ROW_CONFLICT'; end if;
    end if;
    response_value:=jsonb_build_object('ok',true,'row',to_jsonb(company));
    insert into public.ph_manager_table_commands(command_id,actor_profile_id,table_name,operation,request_hash,response)
      values(v_command_id,p_actor_id,p_table,p_operation,v_request_hash,response_value);
    return response_value;
  end if;
  if p_table='inquiry-coverage' then
    if p_payload ?| array['created_at','updated_at','updated_by','revision','access_code','permission_overrides']
      or (p_operation='create' and p_payload ? 'id') then
      raise exception using errcode='22023',message='MANAGER_TABLE_FIELDS_FORBIDDEN';
    end if;
    if p_operation='delete' then
      delete from public.ph_inquiry_coverage where id=row_id and revision=expected_revision returning * into coverage;
      if coverage.id is null then raise exception using errcode='PT409',message='MANAGER_TABLE_ROW_CONFLICT'; end if;
      response_value:=jsonb_build_object('ok',true,'deletedId',row_id);
      insert into public.ph_manager_table_commands(command_id,actor_profile_id,table_name,operation,request_hash,response)
        values(v_command_id,p_actor_id,p_table,p_operation,v_request_hash,response_value);
      return response_value;
    end if;
    if p_payload->>'scope' not in ('block','location','group','all') then
      raise exception using errcode='22023',message='MANAGER_TABLE_SCOPE_INVALID';
    end if;
    if not exists(select 1 from (
        select lower(btrim(access.username)) as username from public.user_access_control access join public.profiles profile on profile.id=access.profile_id
          where access.active and profile.disabled_at is null and not profile.must_change_password
        union select lower(btrim(directory.username)) from public.ph_company_directory directory where directory.active
      ) eligible where eligible.username=lower(btrim(p_payload->>'primary_user')))
      or (nullif(btrim(p_payload->>'backup_user'),'') is not null and not exists(select 1 from (
        select lower(btrim(access.username)) as username from public.user_access_control access join public.profiles profile on profile.id=access.profile_id
          where access.active and profile.disabled_at is null and not profile.must_change_password
        union select lower(btrim(directory.username)) from public.ph_company_directory directory where directory.active
      ) eligible where eligible.username=lower(btrim(p_payload->>'backup_user')))) then
      raise exception using errcode='22023',message='MANAGER_TABLE_USER_NOT_ACTIVE';
    end if;
    if p_operation='create' then
      insert into public.ph_inquiry_coverage(block,location,group_name,scope,primary_user,backup_user,notes,active,updated_by)
      values(nullif(btrim(p_payload->>'block'),''),nullif(btrim(p_payload->>'location'),''),nullif(btrim(p_payload->>'group_name'),''),
        p_payload->>'scope',lower(btrim(p_payload->>'primary_user')),nullif(lower(btrim(p_payload->>'backup_user')),''),
        nullif(p_payload->>'notes',''),coalesce((p_payload->>'active')::boolean,true),actor.username) returning * into coverage;
    else
      update public.ph_inquiry_coverage set block=nullif(btrim(p_payload->>'block'),''),location=nullif(btrim(p_payload->>'location'),''),
        group_name=nullif(btrim(p_payload->>'group_name'),''),scope=p_payload->>'scope',primary_user=lower(btrim(p_payload->>'primary_user')),
        backup_user=nullif(lower(btrim(p_payload->>'backup_user')),''),notes=nullif(p_payload->>'notes',''),
        active=coalesce((p_payload->>'active')::boolean,active),revision=revision+1,updated_by=actor.username,updated_at=statement_timestamp()
      where id=row_id and revision=expected_revision returning * into coverage;
      if coverage.id is null then raise exception using errcode='PT409',message='MANAGER_TABLE_ROW_CONFLICT'; end if;
    end if;
    response_value:=jsonb_build_object('ok',true,'row',to_jsonb(coverage));
    insert into public.ph_manager_table_commands(command_id,actor_profile_id,table_name,operation,request_hash,response)
      values(v_command_id,p_actor_id,p_table,p_operation,v_request_hash,response_value);
    return response_value;
  end if;
  raise exception using errcode='42501',message='MANAGER_TABLE_OPERATION_FORBIDDEN';
end
$$;
revoke all on function public.manager_table_management_v2397(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.manager_table_management_v2397(uuid,text,text,jsonb) to service_role;
alter function public.manager_table_management_v2397(uuid,text,text,jsonb) owner to postgres;

commit;
