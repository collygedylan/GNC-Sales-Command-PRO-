begin;

create schema if not exists sales_private;
revoke all on schema sales_private from public, anon, authenticated;

create function sales_private.key(p_value text) returns text language sql immutable set search_path='' as $$
  select lower(btrim(regexp_replace(coalesce(p_value,''), '[[:space:]]+', ' ', 'g')))
$$;
create function sales_private.identity_key(p_value text) returns text language sql immutable set search_path='' as $$
  select trim(both '_' from regexp_replace(split_part(lower(btrim(coalesce(p_value,''))),'@',1),'[^a-z0-9]+','_','g'))
$$;
create function sales_private.is_rep(p_role text) returns boolean language sql immutable set search_path='' as $$
  select regexp_replace(upper(coalesce(p_role,'')),'[^A-Z0-9]','','g') in ('REP','SALES','SALE','SALESUSER','SALESROLE') or regexp_replace(upper(coalesce(p_role,'')),'[^A-Z0-9]','','g') like '%SALESREP%'
$$;
create function sales_private.actor(p_id uuid) returns public.profiles language plpgsql stable security definer set search_path='' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id=p_id and disabled_at is null and not must_change_password
    and (locked_until is null or locked_until<=now());
  if p.id is null then raise exception using errcode='42501',message='SALES_ACTOR_NOT_ACTIVE'; end if;
  return p;
end $$;

-- Exact, unambiguous identities only. A CSR creator is never used as the assigned rep.
create table sales_private.rep_identities (
  kind text not null check(kind in ('username','name','external_id')),
  identity_key text not null,
  profile_id uuid not null references public.profiles(id),
  verified_at timestamptz not null default now(),
  primary key(kind,identity_key)
);
insert into sales_private.rep_identities(kind,identity_key,profile_id)
select 'username',sales_private.identity_key(username),(array_agg(id))[1] from public.profiles
where (sales_private.is_rep(role) or username in ('ben_brown','chance_alldredge')) group by sales_private.identity_key(username) having count(*)=1;
insert into sales_private.rep_identities(kind,identity_key,profile_id)
select 'name',sales_private.identity_key(display_name),(array_agg(id))[1] from public.profiles
where (sales_private.is_rep(role) or username in ('ben_brown','chance_alldredge')) and nullif(btrim(display_name),'') is not null
group by sales_private.identity_key(display_name) having count(*)=1;
insert into sales_private.rep_identities(kind,identity_key,profile_id)
select 'external_id',sales_private.key(m.salesrepid),(array_agg(distinct i.profile_id))[1]
from public.ph_customer_consignee_sales_reps m join sales_private.rep_identities i
on i.kind='name' and i.identity_key=sales_private.identity_key(m.salesrepname)
where nullif(btrim(m.salesrepid),'') is not null group by sales_private.key(m.salesrepid)
having count(distinct i.profile_id)=1;

create function sales_private.assigned_rep(p_row jsonb) returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid; candidate text;
begin
  candidate := nullif(sales_private.identity_key(p_row->>'request_selected_rep_username'),'');
  if candidate is not null then
    select profile_id into result from sales_private.rep_identities where kind='username' and identity_key=candidate;
    return result;
  end if;
  candidate := nullif(sales_private.key(p_row->>'salesrepid'),'');
  if candidate is not null then
    select profile_id into result from sales_private.rep_identities where kind='external_id' and identity_key=candidate;
    if result is not null then return result; end if;
  end if;
  candidate := sales_private.identity_key(coalesce(nullif(p_row->>'salesrepname',''),nullif(p_row->>'request_selected_rep_display',''),p_row->>'requested_by'));
  select (array_agg(distinct profile_id))[1] into result from sales_private.rep_identities
    where kind in ('name','username') and identity_key=candidate having count(distinct profile_id)=1;
  return result;
end $$;



create function sales_private.customer_key(p_row jsonb) returns text language sql immutable set search_path='' as $$
  select md5(jsonb_build_array(
    coalesce(nullif(sales_private.key(p_row->>'customeridentityid'),''),'name:'||sales_private.key(coalesce(p_row->>'customername',p_row->>'req_customer',p_row->>'request_customer'))),
    coalesce(nullif(sales_private.key(coalesce(p_row->>'consigneeidentityid',p_row->>'consigneeid')),''),'name:'||sales_private.key(p_row->>'consigneename'))
  )::text)
$$;

create table public.ph_credit_sources (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check(source_kind in ('docks','request_history')),
  source_id text not null,
  customer_key text not null,
  assigned_rep_id uuid references public.profiles(id),
  snapshot jsonb not null,
  revision bigint not null default 1,
  needs_review boolean not null default false,
  possible_replacements uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_kind,source_id)
);
create index ph_credit_sources_customer on public.ph_credit_sources(customer_key,id);
create index ph_credit_sources_rep on public.ph_credit_sources(assigned_rep_id,updated_at desc,id);
alter table public.ph_credit_sources add column canonical_source_id uuid references public.ph_credit_sources(id);
create table sales_private.source_versions (
  source_id uuid not null references public.ph_credit_sources(id), revision bigint not null,
  snapshot jsonb not null, recorded_at timestamptz not null default now(), primary key(source_id,revision)
);
create table sales_private.source_aliases (
  source_kind text not null, source_id text not null, canonical_id uuid not null references public.ph_credit_sources(id),
  reason text not null, actor_id uuid, created_at timestamptz not null default now(), primary key(source_kind,source_id)
);
create table public.ph_credit_submissions (
  id uuid primary key, customer_key text not null, actor_id uuid not null references public.profiles(id),
  state text not null check(state in ('draft','submitted')), revision bigint not null default 1,
  draft_lines jsonb not null default '[]', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), submitted_at timestamptz
);
create index ph_credit_submission_actor on public.ph_credit_submissions(actor_id,state,updated_at desc,id);
alter table public.ph_sales_credit_requests
  add column if not exists submission_id uuid references public.ph_credit_submissions(id),
  add column if not exists source_id uuid references public.ph_credit_sources(id),
  add column if not exists actor_id uuid references public.profiles(id),
  add column if not exists assigned_rep_id uuid references public.profiles(id),
  add column if not exists revision bigint not null default 1,
  add column if not exists attachment_ids uuid[] not null default '{}';
create index ph_credit_line_source_status on public.ph_sales_credit_requests(source_id,credit_status);
create index ph_credit_line_submission on public.ph_sales_credit_requests(submission_id,submitted_at desc,unique_id);
create table public.ph_credit_attachments (
  id uuid primary key, source_id uuid not null references public.ph_credit_sources(id), actor_id uuid not null references public.profiles(id),
  object_path text not null unique, mime text not null, byte_count integer not null check(byte_count between 1 and 8388608),
  sha256 text not null, state text not null check(state in ('pending','ready')), created_at timestamptz not null default now()
);
create table sales_private.review_events (
  id uuid primary key default gen_random_uuid(), line_id text, submission_id uuid, source_id uuid,
  actor_id uuid not null, operation text not null, before_value jsonb, after_value jsonb, reason text,
  created_at timestamptz not null default now()
);
create table sales_private.repeat_authorizations (
  id uuid primary key default gen_random_uuid(), source_id uuid not null references public.ph_credit_sources(id),
  requester_id uuid not null references public.profiles(id), reviewer_id uuid not null references public.profiles(id),
  reason text not null, created_at timestamptz not null default now(), consumed_by text, consumed_at timestamptz
);
create table sales_private.commands (
  actor_id uuid not null, command_id uuid not null, fingerprint text not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(actor_id,command_id)
);

create function sales_private.can_read_source(p_actor uuid,p_rep uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id=p_actor and disabled_at is null and not must_change_password and (locked_until is null or locked_until<=now());
  if p.id is null then return false; end if;
  if sales_private.is_rep(p.role) or p.username in ('ben_brown','chance_alldredge') then return coalesce(p.id=p_rep,false); end if;
  -- Preserve existing non-rep oversight. Module eligibility is checked separately.
  return true;
end $$;


create function sales_private.can_read_line(p_actor uuid,p_line public.ph_sales_credit_requests) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=p_actor and p.disabled_at is null and not p.must_change_password and (p.locked_until is null or p.locked_until<=now())
    and ((not sales_private.is_rep(p.role) and p.username not in ('ben_brown','chance_alldredge')) or p.id=p_line.assigned_rep_id or p.id=p_line.actor_id))
$$;
create function sales_private.require_module(p_actor uuid,p_view text) returns void language plpgsql stable security definer set search_path='' as $$
begin
  if public.navigation_module_allowed_v1(p_actor,p_view) is distinct from true then
    raise exception using errcode='42501',message='SALES_MODULE_FORBIDDEN';
  end if;
end $$;

create function sales_private.capture_source(p_kind text,p_row jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid; existing public.ph_credit_sources; candidates uuid[]; source_key text := p_row->>'unique_id'; key text;
begin
  if nullif(source_key,'') is null then return null; end if;
  if p_kind='docks' and nullif(btrim(p_row->>'invoicedate'),'') is not null
    and not exists(select 1 from public.ph_credit_sources where source_kind=p_kind and source_id=source_key) then return null; end if;
  if p_kind='request_history' and lower(coalesce(p_row->>'req_status','')) not in ('complete','completed') then return null; end if;
  select * into existing from public.ph_credit_sources where source_kind=p_kind and source_id=source_key for update;
  if existing.id is not null and existing.snapshot=p_row then return existing.id; end if;
  key := sales_private.customer_key(p_row);
  if existing.id is null and p_kind='docks' and nullif(p_row->>'transactionnumber','') is not null then
    select coalesce(array_agg(s.id),'{}') into candidates from public.ph_credit_sources s
    where s.source_kind='docks' and s.customer_key=key and s.source_id<>source_key
      and s.snapshot->>'transactionnumber'=p_row->>'transactionnumber'
      and sales_private.key(s.snapshot->>'itemcode')=sales_private.key(p_row->>'itemcode')
      and sales_private.key(s.snapshot->>'contsize')=sales_private.key(p_row->>'contsize')
      and sales_private.key(s.snapshot->>'lotcode')=sales_private.key(p_row->>'lotcode')
      and not exists(select 1 from public.ph_soc_master live where live.unique_id=s.source_id);
  end if;
  insert into public.ph_credit_sources(source_kind,source_id,customer_key,assigned_rep_id,snapshot,needs_review,possible_replacements)
  values(p_kind,source_key,key,sales_private.assigned_rep(p_row),p_row,coalesce(cardinality(candidates)>0,false),coalesce(candidates,'{}'))
  on conflict(source_kind,source_id) do update set snapshot=excluded.snapshot,assigned_rep_id=coalesce(ph_credit_sources.assigned_rep_id,excluded.assigned_rep_id),
    revision=ph_credit_sources.revision+1,updated_at=now() returning id into sid;
  insert into sales_private.source_versions(source_id,revision,snapshot)
  select id,revision,snapshot from public.ph_credit_sources where id=sid;
  return sid;
end $$;
create function sales_private.capture_docks_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin perform sales_private.capture_source('docks',to_jsonb(new)); return new; end $$;
create trigger credit_archive_docks after insert or update on public.ph_soc_master for each row execute function sales_private.capture_docks_trigger();

alter table public.ph_request_history add column if not exists assigned_rep_id uuid references public.profiles(id);
create function sales_private.history_identity_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin new.assigned_rep_id:=sales_private.assigned_rep(coalesce(new.snapshot,'{}')||to_jsonb(new)); return new; end $$;
create trigger credit_history_identity before insert or update on public.ph_request_history for each row execute function sales_private.history_identity_trigger();
create function sales_private.history_archive_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin perform sales_private.capture_source('request_history',coalesce(new.snapshot,'{}')||to_jsonb(new)); return new; end $$;
create trigger credit_archive_history after insert or update on public.ph_request_history for each row execute function sales_private.history_archive_trigger();

-- Backfill calls only the existing snapshot writer; no completion/email commands.
do $$ declare r record; begin
  for r in select a.unique_id from public.ph_active_request a where lower(coalesce(a.req_status,'')) in ('complete','completed')
    and not exists(select 1 from public.ph_request_history h where h.unique_id=a.unique_id)
  loop perform private.upsert_request_history(r.unique_id,'recovered','unknown',true); end loop;
end $$;
update public.ph_request_history set assigned_rep_id=sales_private.assigned_rep(coalesce(snapshot,'{}')||to_jsonb(ph_request_history));
select sales_private.capture_source('docks',to_jsonb(s)) from public.ph_soc_master s;

-- Legacy credit rows remain readable and retain every original field.
update public.ph_sales_credit_requests c set actor_id=p.id from public.profiles p
where sales_private.identity_key(c.submitted_by_username)=sales_private.identity_key(p.username) and c.actor_id is null;
update public.ph_sales_credit_requests set assigned_rep_id=sales_private.assigned_rep(coalesce(snapshot,'{}')||to_jsonb(ph_sales_credit_requests));

-- All new workflow storage is API-only. No broad authenticated/anonymous table writes.
do $$ declare t record; begin
  for t in select schemaname,tablename from pg_tables where schemaname='sales_private' or (schemaname='public' and tablename in
    ('ph_credit_sources','ph_credit_submissions','ph_credit_attachments','ph_sales_credit_requests')) loop
    execute format('alter table %I.%I enable row level security',t.schemaname,t.tablename);
    execute format('revoke all on table %I.%I from public, anon, authenticated',t.schemaname,t.tablename);
    execute format('grant all on table %I.%I to service_role',t.schemaname,t.tablename);
  end loop;
  for t in select policyname from pg_policies where schemaname='public' and tablename='ph_sales_credit_requests' loop
    execute format('drop policy %I on public.ph_sales_credit_requests',t.policyname);
  end loop;
  for t in select policyname from pg_policies where schemaname='public' and tablename='ph_request_history' and cmd in ('SELECT','ALL') loop
    execute format('drop policy %I on public.ph_request_history',t.policyname);
  end loop;
end $$;
create function private.can_read_sales_history_v1(p_rep uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  return coalesce(public.navigation_module_allowed_v1(auth.uid(),'request-history'),false) and sales_private.can_read_source(auth.uid(),p_rep);
end $$;
revoke all on function private.can_read_sales_history_v1(uuid) from public,anon;
grant execute on function private.can_read_sales_history_v1(uuid) to authenticated;
create policy ph_request_history_sales_scoped_read on public.ph_request_history for select to authenticated
using(private.can_read_sales_history_v1(assigned_rep_id));
revoke insert,update,delete on public.ph_request_history from anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sales-credit-evidence','sales-credit-evidence',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Read-only pagination is applied after ownership filtering, including aggregates.

create function public.request_history_command_v1(p_actor_id uuid,p_operation text,p_payload jsonb default '{}',p_command_id uuid default null,p_expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; result jsonb; lim integer:=least(100,greatest(1,coalesce((p_payload->>'limit')::integer,40))); q text:=sales_private.key(p_payload->>'query');
  status text:=coalesce(p_payload->>'status',case when p_operation='compatibility' then 'all' else 'completed' end); cursor_at timestamptz:=private.try_timestamptz(p_payload#>>'{cursor,at}'); cursor_id text:=coalesce(p_payload#>>'{cursor,id}','');
begin
  actor:=sales_private.actor(p_actor_id);
  if p_operation='compatibility' then
    if not (public.navigation_module_allowed_v1(actor.id,'request-history') or public.navigation_module_allowed_v1(actor.id,'reports') or (public.navigation_module_allowed_v1(actor.id,'request') and private.navigation_legacy_allowed_v1(actor.id,'request'))) then return jsonb_build_object('rows','[]'::jsonb,'nextCursor',null); end if;
  else perform sales_private.require_module(actor.id,'request-history'); end if;
  if p_operation not in ('search','folders','detail','compatibility') or status not in ('completed','pending','all') then raise exception 'HISTORY_OPERATION_INVALID'; end if;
  with source as (
    select coalesce(h.snapshot,'{}')||to_jsonb(h) row,h.assigned_rep_id rep from public.ph_request_history h
    union all select to_jsonb(a),sales_private.assigned_rep(to_jsonb(a)) from public.ph_active_request a
    where not exists(select 1 from public.ph_request_history h where h.unique_id=a.unique_id)
  ), normalized as (
    select row||jsonb_build_object('customerKey',sales_private.customer_key(row),'customername',coalesce(nullif(row->>'customername',''),row->>'req_customer',row->>'request_customer','Unknown customer'),
      'consigneename',coalesce(row->>'consigneename',''),'assigned_rep_id',rep,'status',case when lower(row->>'req_status') in ('complete','completed') then 'completed' else 'pending' end) row,
      coalesce(case when lower(row->>'req_status') in ('complete','completed') then private.try_timestamptz(row->>'date_completed') end,private.try_timestamptz(row->>'created_at'),'epoch'::timestamptz) sort_at
    from source where sales_private.can_read_source(actor.id,rep)
  ), filtered as (
    select row||jsonb_build_object('sort_at',sort_at) row,sort_at from normalized
    where (status='all' or row->>'status'=status) and (q='' or position(q in sales_private.key(row->>'commonname'))>0)
      and (nullif(p_payload->>'customerKey','') is null or row->>'customerKey'=p_payload->>'customerKey')
      and (p_operation<>'detail' or row->>'unique_id'=p_payload->>'id')
  ), page as (
    select * from filtered where cursor_at is null or (sort_at,row->>'unique_id')<(cursor_at,cursor_id)
    order by sort_at desc,row->>'unique_id' desc limit lim+1
  ), folders as (
    select row->>'customerKey' key,max(row->>'customername') customer,max(row->>'consigneename') consignee,count(*) count from filtered
    group by row->>'customerKey' having coalesce(p_payload#>>'{cursor,key}','')='' or row->>'customerKey'>p_payload#>>'{cursor,key}' order by row->>'customerKey' limit lim+1
  ) select case when p_operation='folders' then jsonb_build_object('folders',coalesce((select jsonb_agg(jsonb_build_object('customerKey',key,'customername',customer,'consigneename',consignee,'count',count) order by key) from (select * from folders limit lim) f),'[]'::jsonb),
    'nextCursor',case when (select count(*) from folders)>lim then (select jsonb_build_object('key',key) from folders offset lim-1 limit 1) end)
    else jsonb_build_object('rows',coalesce((select jsonb_agg(row order by sort_at desc,row->>'unique_id' desc) from (select * from page limit lim) r),'[]'::jsonb),
    'nextCursor',case when (select count(*) from page)>lim then (select jsonb_build_object('at',sort_at,'id',row->>'unique_id') from page offset lim-1 limit 1) end) end into result;
  return result;
end $$;

create function public.sales_credit_command_v1(p_actor_id uuid,p_operation text,p_payload jsonb default '{}',p_command_id uuid default null,p_expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; reviewer boolean; result jsonb; prior sales_private.commands; fingerprint text;
  lim integer:=least(100,greatest(1,coalesce((p_payload->>'limit')::integer,40))); q text:=sales_private.key(p_payload->>'query');
  draft public.ph_credit_submissions; src public.ph_credit_sources; line public.ph_sales_credit_requests; entry jsonb; lines jsonb:='[]';
  work_id uuid; a_id uuid; qty numeric; explanation text; previous jsonb; reason text:=btrim(coalesce(p_payload->>'reason',''));
begin
  actor:=sales_private.actor(p_actor_id);
  if p_operation='compatibility' then
    if not (public.navigation_module_allowed_v1(actor.id,'sales-credit') or public.navigation_module_allowed_v1(actor.id,'credit-request') or public.navigation_module_allowed_v1(actor.id,'reports')) then return jsonb_build_object('rows','[]'::jsonb,'nextCursor',null); end if;
    with page as (select c.* from public.ph_sales_credit_requests c where sales_private.can_read_line(actor.id,c) and (nullif(p_payload#>>'{cursor,id}','') is null or c.unique_id>p_payload#>>'{cursor,id}') order by c.unique_id limit lim+1)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(coalesce(c.snapshot,'{}')||to_jsonb(c) order by c.unique_id) from (select * from page limit lim)c),'[]'::jsonb),'nextCursor',case when (select count(*) from page)>lim then (select jsonb_build_object('id',unique_id) from page offset lim-1 limit 1) end) into result;
    return result;
  end if;
  if p_operation<>'detail' then perform sales_private.require_module(actor.id,case when p_operation in ('submissions','review_line','authorize_repeat','amend_line','resolve_source') then 'credit-request' else 'sales-credit' end); end if;
  reviewer:=actor.username in ('dylan_collyge','jd_jones','megan_kelly');
  if p_operation='folders' then
    with folders as (
      select customer_key,max(coalesce(snapshot->>'customername',snapshot->>'req_customer',snapshot->>'request_customer','Unknown customer')) customer,
        max(coalesce(snapshot->>'consigneename','')) consignee,count(*) count
      from public.ph_credit_sources s where sales_private.can_read_source(actor.id,s.assigned_rep_id) and canonical_source_id is null
        and (q='' or position(q in sales_private.key(concat_ws(' ',snapshot->>'customername',snapshot->>'req_customer',snapshot->>'consigneename',snapshot->>'itemcode',snapshot->>'commonname')))>0)
      group by customer_key having coalesce(p_payload#>>'{cursor,key}','')='' or customer_key>p_payload#>>'{cursor,key}' order by customer_key limit lim+1
    ) select jsonb_build_object('folders',coalesce((select jsonb_agg(jsonb_build_object('customerKey',customer_key,'customername',customer,'consigneename',consignee,'count',count) order by customer_key) from (select * from folders limit lim) f),'[]'),
      'nextCursor',case when (select count(*) from folders)>lim then (select jsonb_build_object('key',customer_key) from folders offset lim-1 limit 1) end) into result;
    return result;
  elsif p_operation='sources' then
    with visible as (select s.* from public.ph_credit_sources s where sales_private.can_read_source(actor.id,s.assigned_rep_id) and canonical_source_id is null
      and (nullif(p_payload->>'customerKey','') is null or s.customer_key=p_payload->>'customerKey')
      and (q='' or position(q in sales_private.key(coalesce(snapshot->>'itemcode','')||' '||coalesce(snapshot->>'commonname','')))>0)
      and (nullif(p_payload#>>'{cursor,id}','') is null or s.id>(p_payload#>>'{cursor,id}')::uuid) order by id limit lim+1)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('canResolve',reviewer,'canAuthorizeRepeat',reviewer and exists(select 1 from public.ph_sales_credit_requests pc where pc.source_id=s.id and pc.credit_status in ('pending','approved')),'possibleMatches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'label',concat_ws(' / ',m.snapshot->>'itemcode',m.snapshot->>'dock',m.snapshot->>'stopnumber',m.snapshot->>'transactionnumber'))) from public.ph_credit_sources m where m.id=any(s.possible_replacements) and sales_private.can_read_source(actor.id,m.assigned_rep_id)),'[]'::jsonb),'claims',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.unique_id,'status',c.credit_status,'quantity',c.credit_qty,'submitted_at',c.submitted_at) order by c.submitted_at desc)
      from public.ph_sales_credit_requests c left join public.ph_credit_sources cs on cs.id=c.source_id
      where coalesce(cs.canonical_source_id,c.source_id)=s.id and sales_private.can_read_line(actor.id,c)), '[]'::jsonb)) order by s.id) from (select * from visible limit lim) s),'[]'::jsonb),
      'nextCursor',case when (select count(*) from visible)>lim then (select jsonb_build_object('id',id) from visible offset lim-1 limit 1) end) into result;
    if reviewer then result:=result||jsonb_build_object('requesters',coalesce((select jsonb_agg(jsonb_build_object('id',id,'username',username,'display_name',display_name) order by username) from public.profiles where disabled_at is null and not must_change_password),'[]'::jsonb)); end if;
    return result;
  elsif p_operation='drafts' then
    select jsonb_build_object('drafts',coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('lines',s.draft_lines) order by s.updated_at desc,s.id),'[]')) into result
    from public.ph_credit_submissions s where actor_id=actor.id and state='draft'; return result;
  elsif p_operation='submissions' then
    if coalesce(p_payload->>'status','pending') not in ('pending','approved','denied') then raise exception 'CREDIT_STATUS_INVALID'; end if;
    with matching as (select c.* from public.ph_sales_credit_requests c where c.credit_status=coalesce(p_payload->>'status','pending') and sales_private.can_read_line(actor.id,c)
      and (q='' or position(q in sales_private.key(concat_ws(' ',c.itemcode,c.commonname,c.customername,c.consigneename)))>0)),
    groups as (select coalesce(c.submission_id::text,c.unique_id) id,max(c.submitted_at) submitted_at,count(*) line_count,
      jsonb_build_object('customername',max(c.customername),'consigneename',max(c.consigneename)) snapshot
      from matching c group by coalesce(c.submission_id::text,c.unique_id)),
    page as (select * from groups where nullif(p_payload#>>'{cursor,id}','') is null or (submitted_at,id)<((p_payload#>>'{cursor,at}')::timestamptz,p_payload#>>'{cursor,id}') order by submitted_at desc,id desc limit lim+1)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(s) order by submitted_at desc,id desc) from (select * from page limit lim) s),'[]'),
      'canReview',reviewer,'nextCursor',case when (select count(*) from page)>lim then (select jsonb_build_object('id',id,'at',submitted_at) from page offset lim-1 limit 1) end) into result;
    return result;
  elsif p_operation='detail' then
    select * into draft from public.ph_credit_submissions where id::text=p_payload->>'id';
    if draft.state='draft' then
      perform sales_private.require_module(actor.id,'sales-credit');
      if draft.actor_id<>actor.id then raise exception using errcode='42501',message='CREDIT_DRAFT_FORBIDDEN'; end if;
      return jsonb_build_object('draft',to_jsonb(draft)||jsonb_build_object('lines',draft.draft_lines));
    end if;
    perform sales_private.require_module(actor.id,'credit-request');
    select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('id',c.unique_id,'status',c.credit_status,'quantity',c.credit_qty,'explanation',c.credit_reason,
      'canAmend',reviewer or (c.actor_id=actor.id and c.credit_status='pending'),'reviewHistory',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from sales_private.review_events e where e.line_id=c.unique_id),'[]')) order by c.unique_id),'[]') into lines
    from public.ph_sales_credit_requests c where (c.submission_id::text=p_payload->>'id' or (c.submission_id is null and c.unique_id=p_payload->>'id')) and sales_private.can_read_line(actor.id,c);
    if jsonb_array_length(lines)=0 then raise exception using errcode='42501',message='CREDIT_DETAIL_FORBIDDEN'; end if;
    return jsonb_build_object('submission',coalesce(to_jsonb(draft)-'draft_lines',jsonb_build_object('id',p_payload->>'id','state','submitted')),'lines',lines,'canReview',reviewer);
  end if;

  if p_operation not in ('save_draft','submit','review_line','authorize_repeat','amend_line','resolve_source') then raise exception 'CREDIT_OPERATION_INVALID'; end if;
  if p_command_id is null then raise exception 'CREDIT_COMMAND_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_command_id::text,0));
  fingerprint:=md5(jsonb_build_array(p_operation,p_payload,p_expected_revision)::text);
  select * into prior from sales_private.commands where actor_id=actor.id and command_id=p_command_id;
  if prior.command_id is not null then
    if prior.fingerprint<>fingerprint then raise exception 'CREDIT_COMMAND_CONFLICT'; end if;
    return prior.result;
  end if;

  if p_operation='save_draft' then
    work_id:=(p_payload->>'id')::uuid;
    if work_id is null or jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')>100 then raise exception 'CREDIT_DRAFT_INVALID'; end if;
    perform pg_advisory_xact_lock(hashtextextended(work_id::text,1));
    select * into draft from public.ph_credit_submissions where ph_credit_submissions.id=work_id for update;
    if draft.id is not null and (draft.actor_id<>actor.id or draft.state<>'draft') then raise exception using errcode='42501',message='CREDIT_DRAFT_FORBIDDEN'; end if;
    if p_expected_revision is distinct from coalesce(draft.revision,0) then raise exception 'CREDIT_REVISION_CONFLICT'; end if;
    if (select count(*) from jsonb_array_elements(p_payload->'lines'))<>(select count(distinct x->>'id') from jsonb_array_elements(p_payload->'lines') x)
      or (select count(*) from jsonb_array_elements(p_payload->'lines'))<>(select count(distinct x->>'sourceId') from jsonb_array_elements(p_payload->'lines') x) then raise exception 'CREDIT_DUPLICATE_LINE'; end if;
    for entry in select value from jsonb_array_elements(p_payload->'lines') loop
      perform (entry->>'id')::uuid;
      select * into src from public.ph_credit_sources where ph_credit_sources.id=(entry->>'sourceId')::uuid;
      if src.id is null or not sales_private.can_read_source(actor.id,src.assigned_rep_id) then raise exception using errcode='42501',message='CREDIT_SOURCE_FORBIDDEN'; end if;
      if src.canonical_source_id is not null then raise exception 'CREDIT_SOURCE_CHANGED_RESELECT'; end if;
      if src.customer_key is distinct from p_payload->>'customerKey' then raise exception 'CREDIT_CUSTOMER_MISMATCH'; end if;
      if length(coalesce(entry->>'explanation',''))>10000 or length(coalesce(entry->>'quantity',''))>50 then raise exception 'CREDIT_LINE_INVALID'; end if;
      if entry ? 'attachmentIds' and jsonb_typeof(entry->'attachmentIds')<>'array' then raise exception 'CREDIT_ATTACHMENTS_INVALID'; end if;
      if jsonb_array_length(coalesce(entry->'attachmentIds','[]'))>30 then raise exception 'CREDIT_ATTACHMENTS_INVALID'; end if;
      for a_id in select value::uuid from jsonb_array_elements_text(coalesce(entry->'attachmentIds','[]')) loop
        if not exists(select 1 from public.ph_credit_attachments where ph_credit_attachments.id=a_id and actor_id=actor.id and source_id=src.id and state='ready') then raise exception using errcode='42501',message='CREDIT_ATTACHMENT_FORBIDDEN'; end if;
      end loop;
      lines:=lines||jsonb_build_array(jsonb_build_object('id',entry->>'id','sourceId',src.id,'sourceRevision',src.revision,'quantity',entry->>'quantity',
        'explanation',coalesce(entry->>'explanation',''),'attachmentIds',coalesce(entry->'attachmentIds','[]'),'snapshot',src.snapshot));
    end loop;
    insert into public.ph_credit_submissions(id,customer_key,actor_id,state,draft_lines) values(work_id,p_payload->>'customerKey',actor.id,'draft',lines)
    on conflict(id) do update set customer_key=excluded.customer_key,draft_lines=excluded.draft_lines,revision=ph_credit_submissions.revision+1,updated_at=now() returning * into draft;
    result:=jsonb_build_object('draft',to_jsonb(draft)||jsonb_build_object('lines',draft.draft_lines));
  elsif p_operation='submit' then
    select * into draft from public.ph_credit_submissions where ph_credit_submissions.id=(p_payload->>'id')::uuid for update;
    if draft.id is null or draft.actor_id<>actor.id then raise exception using errcode='42501',message='CREDIT_DRAFT_FORBIDDEN'; end if;
    if draft.state<>'draft' then raise exception 'CREDIT_ALREADY_SUBMITTED'; end if;
    if p_expected_revision is distinct from draft.revision then raise exception 'CREDIT_REVISION_CONFLICT'; end if;
    if jsonb_array_length(draft.draft_lines)=0 then raise exception 'CREDIT_LINES_REQUIRED'; end if;
    -- Source locks serialize repeat-claim checks across requesters and devices.
    perform s.id from public.ph_credit_sources s where s.id in (select (x->>'sourceId')::uuid from jsonb_array_elements(draft.draft_lines)x) order by s.id for update;
    for entry in select value from jsonb_array_elements(draft.draft_lines) loop
      select * into src from public.ph_credit_sources where ph_credit_sources.id=(entry->>'sourceId')::uuid;
      if not sales_private.can_read_source(actor.id,src.assigned_rep_id) then raise exception using errcode='42501',message='CREDIT_SOURCE_FORBIDDEN'; end if;
      if src.needs_review then raise exception 'CREDIT_SOURCE_REVIEW_REQUIRED'; end if;
      if src.canonical_source_id is not null or src.revision is distinct from (entry->>'sourceRevision')::bigint then raise exception 'CREDIT_SOURCE_CHANGED'; end if;
      if coalesce(entry->>'quantity','')!~'^[0-9]+([.][0-9]+)?$' then raise exception 'CREDIT_QUANTITY_REQUIRED'; end if;
      qty:=(entry->>'quantity')::numeric; explanation:=btrim(coalesce(entry->>'explanation',''));
      if qty<=0 or qty>1000000000000 or explanation='' then raise exception 'CREDIT_QUANTITY_AND_EXPLANATION_REQUIRED'; end if;
      if exists(select 1 from public.ph_sales_credit_requests c join public.ph_credit_sources s on s.id=c.source_id
        where coalesce(s.canonical_source_id,s.id)=src.id and c.credit_status in ('pending','approved')) then
        select ra.id into a_id from sales_private.repeat_authorizations ra where ra.source_id=src.id and ra.requester_id=actor.id and consumed_at is null order by created_at,id limit 1 for update;
        if a_id is null then raise exception 'CREDIT_REPEAT_AUTHORIZATION_REQUIRED'; end if;
        update sales_private.repeat_authorizations set consumed_at=now(),consumed_by=entry->>'id' where repeat_authorizations.id=a_id;
      end if;
      insert into public.ph_sales_credit_requests(unique_id,submission_id,source_id,actor_id,assigned_rep_id,request_unique_id,customername,consigneename,itemcode,commonname,contsize,locationcode,lotcode,
        req_qty,credit_qty,credit_reason,credit_status,submitted_by_username,submitted_by_display,snapshot,attachment_ids)
      values(entry->>'id',draft.id,src.id,actor.id,src.assigned_rep_id,src.source_id,coalesce(src.snapshot->>'customername',src.snapshot->>'req_customer',src.snapshot->>'request_customer'),src.snapshot->>'consigneename',
        src.snapshot->>'itemcode',src.snapshot->>'commonname',src.snapshot->>'contsize',src.snapshot->>'locationcode',src.snapshot->>'lotcode',coalesce(src.snapshot->>'quantityordered',src.snapshot->>'req_qty'),
        qty::text,explanation,'pending',actor.username,actor.display_name,src.snapshot,array(select value::uuid from jsonb_array_elements_text(entry->'attachmentIds')))
        returning * into line;
      insert into sales_private.review_events(line_id,submission_id,source_id,actor_id,operation,after_value) values(line.unique_id,draft.id,src.id,actor.id,'submitted',to_jsonb(line));
    end loop;
    update public.ph_credit_submissions set state='submitted',submitted_at=now(),updated_at=now(),revision=revision+1 where ph_credit_submissions.id=draft.id returning * into draft;
    result:=jsonb_build_object('submission',to_jsonb(draft));
  elsif p_operation in ('review_line','amend_line') then
    select * into line from public.ph_sales_credit_requests where unique_id=p_payload->>'lineId' for update;
    if line.unique_id is null or not sales_private.can_read_line(actor.id,line) then raise exception using errcode='42501',message='CREDIT_LINE_FORBIDDEN'; end if;
    if p_expected_revision is distinct from line.revision then raise exception 'CREDIT_REVISION_CONFLICT'; end if;
    previous:=to_jsonb(line);
    if p_operation='review_line' then
      if not reviewer then raise exception using errcode='42501',message='CREDIT_REVIEW_FORBIDDEN'; end if;
      if line.credit_status<>'pending' then raise exception 'CREDIT_ALREADY_REVIEWED'; end if;
      if p_payload->>'decision' not in ('approved','denied') or p_payload->>'decision' is null then raise exception 'CREDIT_DECISION_INVALID'; end if;
      if p_payload->>'decision'='denied' and reason='' then raise exception 'CREDIT_DENIAL_REASON_REQUIRED'; end if;
      update public.ph_sales_credit_requests set credit_status=p_payload->>'decision',review_note=reason,reviewed_by_username=actor.username,reviewed_by_display=actor.display_name,
        reviewed_at=now(),revision=revision+1,updated_at=now() where unique_id=line.unique_id returning * into line;
    else
      if not reviewer and (line.actor_id is distinct from actor.id or line.credit_status<>'pending') then raise exception using errcode='42501',message='CREDIT_AMENDMENT_FORBIDDEN'; end if;
      if reason='' then raise exception 'CREDIT_AMENDMENT_REASON_REQUIRED'; end if;
      if coalesce(p_payload->>'quantity','')!~'^[0-9]+([.][0-9]+)?$' then raise exception 'CREDIT_QUANTITY_REQUIRED'; end if;
      qty:=(p_payload->>'quantity')::numeric; explanation:=btrim(coalesce(p_payload->>'explanation',''));
      if qty<=0 or qty>1000000000000 or explanation='' then raise exception 'CREDIT_QUANTITY_AND_EXPLANATION_REQUIRED'; end if;
      update public.ph_sales_credit_requests set credit_qty=qty::text,credit_reason=explanation,credit_status='pending',review_note=null,reviewed_at=null,reviewed_by_username=null,reviewed_by_display=null,
        revision=revision+1,updated_at=now() where unique_id=line.unique_id returning * into line;
    end if;
    insert into sales_private.review_events(line_id,submission_id,source_id,actor_id,operation,before_value,after_value,reason)
    values(line.unique_id,line.submission_id,line.source_id,actor.id,p_operation,previous,to_jsonb(line),reason);
    result:=jsonb_build_object('line',to_jsonb(line));
  elsif p_operation='authorize_repeat' then
    if not reviewer then raise exception using errcode='42501',message='CREDIT_REVIEW_FORBIDDEN'; end if;
    select * into src from public.ph_credit_sources where ph_credit_sources.id=(p_payload->>'sourceId')::uuid for update;
    if src.id is null or reason='' then raise exception 'CREDIT_SOURCE_AND_REASON_REQUIRED'; end if;
    if p_expected_revision is distinct from src.revision then raise exception 'CREDIT_REVISION_CONFLICT'; end if;
    work_id:=(p_payload->>'requesterId')::uuid;
    perform sales_private.actor(work_id);
    if not sales_private.can_read_source(work_id,src.assigned_rep_id) then raise exception using errcode='42501',message='CREDIT_REQUESTER_FORBIDDEN'; end if;
    if exists(select 1 from sales_private.repeat_authorizations where source_id=src.id and requester_id=work_id and consumed_at is null) then raise exception 'CREDIT_AUTHORIZATION_ALREADY_AVAILABLE'; end if;
    insert into sales_private.repeat_authorizations(source_id,requester_id,reviewer_id,reason) values(src.id,work_id,actor.id,reason) returning to_jsonb(repeat_authorizations) into result;
    insert into sales_private.review_events(source_id,actor_id,operation,after_value,reason) values(src.id,actor.id,p_operation,result,reason);
  elsif p_operation='resolve_source' then
    if not reviewer then raise exception using errcode='42501',message='CREDIT_REVIEW_FORBIDDEN'; end if;
    select * into src from public.ph_credit_sources where ph_credit_sources.id=(p_payload->>'sourceId')::uuid for update;
    if src.id is null or reason='' then raise exception 'CREDIT_SOURCE_AND_REASON_REQUIRED'; end if;
    if p_expected_revision is distinct from src.revision then raise exception 'CREDIT_REVISION_CONFLICT'; end if;
    previous:=to_jsonb(src); work_id:=nullif(p_payload->>'canonicalSourceId','')::uuid;
    if work_id is not null then
      if work_id=src.id or not exists(select 1 from public.ph_credit_sources s where s.id=work_id and s.customer_key=src.customer_key and s.canonical_source_id is null) then raise exception 'CREDIT_CANONICAL_SOURCE_INVALID'; end if;
      insert into sales_private.source_aliases(source_kind,source_id,canonical_id,reason,actor_id) values(src.source_kind,src.source_id,work_id,reason,actor.id);
    end if;
    update public.ph_credit_sources set canonical_source_id=work_id,needs_review=false,revision=revision+1,updated_at=now() where ph_credit_sources.id=src.id returning to_jsonb(ph_credit_sources) into result;
    insert into sales_private.review_events(source_id,actor_id,operation,before_value,after_value,reason) values(src.id,actor.id,p_operation,previous,result,reason);
  end if;
  insert into sales_private.commands(actor_id,command_id,fingerprint,result) values(actor.id,p_command_id,fingerprint,result);
  return result;
end $$;

create function public.sales_credit_attachment_v1(p_actor_id uuid,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; src public.ph_credit_sources; attachment public.ph_credit_attachments; work_id uuid:=(p_payload->>'id')::uuid;
begin
  actor:=sales_private.actor(p_actor_id);
  if p_operation='download' then
    if public.navigation_module_allowed_v1(actor.id,'sales-credit') is distinct from true and public.navigation_module_allowed_v1(actor.id,'credit-request') is distinct from true then raise exception using errcode='42501',message='SALES_MODULE_FORBIDDEN'; end if;
  else perform sales_private.require_module(actor.id,'sales-credit'); end if;
  if work_id is null then raise exception 'CREDIT_ATTACHMENT_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(work_id::text,2));
  select * into attachment from public.ph_credit_attachments where id=work_id for update;
  if p_operation='reserve' then
    select * into src from public.ph_credit_sources where id=(p_payload->>'sourceId')::uuid;
    if src.id is null or not sales_private.can_read_source(actor.id,src.assigned_rep_id) then raise exception using errcode='42501',message='CREDIT_SOURCE_FORBIDDEN'; end if;
    if attachment.id is not null then
      if attachment.actor_id<>actor.id or attachment.source_id<>src.id or attachment.sha256 is distinct from p_payload->>'sha256' then raise exception 'CREDIT_ATTACHMENT_COMMAND_CONFLICT'; end if;
      return to_jsonb(attachment);
    end if;
    if p_payload->>'mime' not in ('image/jpeg','image/png','image/webp') or p_payload->>'extension' not in ('jpg','png','webp')
      or coalesce(p_payload->>'sha256','')!~'^[0-9a-f]{64}$' then raise exception 'CREDIT_ATTACHMENT_INVALID'; end if;
    insert into public.ph_credit_attachments(id,source_id,actor_id,object_path,mime,byte_count,sha256,state)
    values(work_id,src.id,actor.id,actor.id::text||'/'||work_id::text||'.'||(p_payload->>'extension'),p_payload->>'mime',(p_payload->>'size')::integer,p_payload->>'sha256','pending')
    returning * into attachment;
  elsif p_operation='finish' then
    if attachment.id is null or attachment.actor_id<>actor.id then raise exception using errcode='42501',message='CREDIT_ATTACHMENT_FORBIDDEN'; end if;
    if attachment.sha256 is distinct from p_payload->>'sha256' then raise exception 'CREDIT_ATTACHMENT_HASH_CONFLICT'; end if;
    if not exists(select 1 from storage.objects where bucket_id='sales-credit-evidence' and name=attachment.object_path) then raise exception 'CREDIT_ATTACHMENT_UPLOAD_INCOMPLETE'; end if;
    update public.ph_credit_attachments set state='ready' where id=work_id returning * into attachment;
  elsif p_operation='download' then
    if attachment.id is null or attachment.state<>'ready' then raise exception 'CREDIT_ATTACHMENT_NOT_FOUND'; end if;
    if attachment.actor_id<>actor.id and not exists(select 1 from public.ph_sales_credit_requests c where attachment.id=any(c.attachment_ids) and sales_private.can_read_line(actor.id,c)) then
      raise exception using errcode='42501',message='CREDIT_ATTACHMENT_FORBIDDEN';
    end if;
  else raise exception 'CREDIT_ATTACHMENT_OPERATION_INVALID'; end if;
  return to_jsonb(attachment);
end $$;

-- Deny client Storage access even if an older permissive policy covers all buckets.
create policy sales_credit_private_objects on storage.objects as restrictive for all to anon,authenticated
using(bucket_id <> 'sales-credit-evidence') with check(bucket_id <> 'sales-credit-evidence');

revoke all on all functions in schema sales_private from public,anon,authenticated;
revoke all on function public.request_history_command_v1(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated;
revoke all on function public.sales_credit_command_v1(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated;
revoke all on function public.sales_credit_attachment_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.request_history_command_v1(uuid,text,jsonb,uuid,bigint) to service_role;
grant execute on function public.sales_credit_command_v1(uuid,text,jsonb,uuid,bigint) to service_role;
grant execute on function public.sales_credit_attachment_v1(uuid,text,jsonb) to service_role;

insert into app_sync_private.sources(key,modules,dylan_only) values
('ph_credit_sources','{sales,request,managers}',false),
('ph_credit_submissions','{sales,request,managers}',false),
('ph_credit_attachments','{sales,request,managers}',false)
on conflict(key) do nothing;
insert into public.app_dataset_revisions(key) select key from app_sync_private.sources
where key in ('ph_credit_sources','ph_credit_submissions','ph_credit_attachments') on conflict(key) do nothing;
create trigger app_dataset_revision_inserted after insert on public.ph_credit_sources referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated after update on public.ph_credit_sources referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted after delete on public.ph_credit_sources referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated after truncate on public.ph_credit_sources
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_inserted after insert on public.ph_credit_submissions referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated after update on public.ph_credit_submissions referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted after delete on public.ph_credit_submissions referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated after truncate on public.ph_credit_submissions
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_inserted after insert on public.ph_credit_attachments referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated after update on public.ph_credit_attachments referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted after delete on public.ph_credit_attachments referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated after truncate on public.ph_credit_attachments
for each statement execute function app_sync_private.touch_source();

commit;
