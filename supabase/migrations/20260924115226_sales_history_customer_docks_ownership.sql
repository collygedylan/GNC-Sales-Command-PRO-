begin;

-- Mixed import APIs must use the same map-first lock order as source writers.
-- Change only lock acquisition; persisted source/canonical key sorting is intact.
do $$ declare signature regprocedure; definition text; needle text:='order by key for update;'; begin
  foreach signature in array array[
    'app_sync_private.begin_import(text[],uuid,text[])'::regprocedure,
    'app_sync_private.advance_import(uuid,text)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(signature);
    if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
      raise exception 'SALES_IMPORT_LOCK_ORDER_PATCH_FAILED: %',signature;
    end if;
    execute replace(definition,needle,'order by (key=''ph_customer_consignee_sales_reps'') desc,key for update;');
  end loop;
end $$;

-- Explicit comma inversion, never fuzzy token matching.
create function sales_private.rep_name_key(p_value text) returns text
language sql immutable set search_path='' as $$
  select sales_private.identity_key(case when coalesce(p_value,'') ~ '^[^,]+,[^,]+$'
    then btrim(split_part(p_value,',',2))||' '||btrim(split_part(p_value,',',1)) else p_value end)
$$;

create or replace function sales_private.assigned_rep(p_row jsonb) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare result uuid; candidate text;
begin
  candidate:=nullif(sales_private.identity_key(p_row->>'request_selected_rep_username'),'');
  if candidate is not null then
    select profile_id into result from sales_private.rep_identities where kind='username' and identity_key=candidate;
    return result;
  end if;
  candidate:=nullif(sales_private.key(p_row->>'salesrepid'),'');
  if candidate is not null then
    -- The last published aliases are not authority for a new assignment while
    -- the underlying multi-request import is incomplete or interrupted.
    if not exists(select 1 from public.app_dataset_revisions
      where key='ph_customer_consignee_sales_reps' and state='ready') then return null; end if;
    select profile_id into result from sales_private.rep_identities where kind='external_id' and identity_key=candidate;
    -- An explicit unknown/conflicting ID must not fall through to a name.
    return result;
  end if;
  candidate:=sales_private.rep_name_key(coalesce(nullif(p_row->>'salesrepname',''),nullif(p_row->>'request_selected_rep_display',''),p_row->>'requested_by'));
  select (array_agg(distinct profile_id))[1] into result from sales_private.rep_identities
    where kind in ('name','username') and identity_key=candidate having count(distinct profile_id)=1;
  return result;
end $$;

create function sales_private.refresh_rep_identities() returns void
language plpgsql security definer set search_path='' as $$
declare map_state text;
begin
  -- Share the publication lock before the identity lock: an import cannot begin
  -- between this readiness check and the mapping read/ownership repair.
  select state into map_state from public.app_dataset_revisions
    where key='ph_customer_consignee_sales_reps' for update;
  if map_state is distinct from 'ready' then return; end if;
  perform pg_advisory_xact_lock(694873,1);
  -- Scope generated aliases explicitly so REST-triggered refresh preserves
  -- safe-update protection instead of attempting an unqualified table delete.
  delete from sales_private.rep_identities where kind in ('username','name','external_id');
  insert into sales_private.rep_identities(kind,identity_key,profile_id)
  with candidates as (
    select p.id,a.kind,a.key from public.profiles p cross join lateral (values
      ('username',sales_private.identity_key(p.username)),('name',sales_private.rep_name_key(p.display_name))) a(kind,key)
    where sales_private.is_rep(p.role) or p.username in ('ben_brown','chance_alldredge')
  ), unambiguous as (
    select key from candidates where key<>'' group by key having count(distinct id)=1
  ) select kind,key,(array_agg(distinct id))[1] from candidates join unambiguous using(key) group by kind,key;
  insert into sales_private.rep_identities(kind,identity_key,profile_id)
  with mapped as (
    select sales_private.key(m.salesrepid) key,(select (array_agg(distinct i.profile_id))[1]
      from sales_private.rep_identities i where i.kind in ('name','username')
        and i.identity_key=sales_private.rep_name_key(m.salesrepname) having count(distinct i.profile_id)=1) profile_id
    from public.ph_customer_consignee_sales_reps m where nullif(btrim(m.salesrepid),'') is not null
  ) select 'external_id',key,(array_agg(distinct profile_id))[1] from mapped group by key
    having count(distinct profile_id)=1 and bool_and(profile_id is not null);
  -- Repair null owners only. Historical assignments are never reallocated.
  update public.ph_request_history h set assigned_rep_id=sales_private.assigned_rep(coalesce(h.snapshot,'{}')||to_jsonb(h))
    where h.assigned_rep_id is null and sales_private.assigned_rep(coalesce(h.snapshot,'{}')||to_jsonb(h)) is not null;
  update public.ph_credit_sources s set assigned_rep_id=sales_private.assigned_rep(s.snapshot),updated_at=now()
    where s.assigned_rep_id is null and sales_private.assigned_rep(s.snapshot) is not null;
  update public.ph_sales_credit_requests c set assigned_rep_id=s.assigned_rep_id
    from public.ph_credit_sources s where c.source_id=s.id and c.assigned_rep_id is null and s.assigned_rep_id is not null;
end $$;
create function sales_private.refresh_rep_identities_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform sales_private.refresh_rep_identities(); return null; end $$;
create trigger credit_rep_mapping_refresh after insert or update or delete or truncate
on public.ph_customer_consignee_sales_reps for each statement execute function sales_private.refresh_rep_identities_trigger();
create trigger credit_rep_profile_refresh after insert or update of username,display_name,role or delete
on public.profiles for each statement execute function sales_private.refresh_rep_identities_trigger();

create function sales_private.refresh_rep_identities_after_import() returns trigger
language plpgsql security definer set search_path='' as $$
declare original_headers text:=current_setting('request.headers',true);
begin
  -- advance_import has already completed the run before publishing ready.
  -- Its validated finalization owns the revision lock until all derived repairs
  -- commit. Derived writes are ordinary writes, not another batch from the now
  -- closed token; restore the caller header immediately after this internal work.
  perform set_config('request.headers',(coalesce(nullif(original_headers,'')::jsonb,'{}'::jsonb)-'x-gnc-import-run-id')::text,true);
  perform sales_private.refresh_rep_identities();
  perform set_config('request.headers',coalesce(original_headers,''),true);
  return null;
end $$;
create trigger credit_rep_mapping_published after update of state on public.app_dataset_revisions
for each row when (new.key='ph_customer_consignee_sales_reps' and new.state='ready' and old.state is distinct from new.state)
execute function sales_private.refresh_rep_identities_after_import();

create function sales_private.lock_rep_publication_before_write() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  -- All writers enter through the map revision before taking source/profile row
  -- locks. Source transactions share it; identity refresh and import publication
  -- exclude them. Never upgrade a shared lock after locking business rows.
  if tg_argv[0]='refresh' then
    perform 1 from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps' for update;
  else
    perform 1 from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps' for share;
  end if;
  return null;
end $$;
create trigger aa_credit_rep_publication_lock before insert or update or delete on public.ph_soc_master
for each statement execute function sales_private.lock_rep_publication_before_write('source');
create trigger aa_credit_rep_publication_lock before insert or update or delete on public.ph_request_history
for each statement execute function sales_private.lock_rep_publication_before_write('source');
create trigger aa_credit_rep_publication_lock before insert or update or delete on public.ph_active_request
for each statement execute function sales_private.lock_rep_publication_before_write('source');
create trigger aa_credit_rep_publication_lock before insert or update or delete or truncate on public.ph_customer_consignee_sales_reps
for each statement execute function sales_private.lock_rep_publication_before_write('refresh');
create trigger aa_credit_rep_publication_lock before insert or update of username,display_name,role or delete on public.profiles
for each statement execute function sales_private.lock_rep_publication_before_write('refresh');

create or replace function sales_private.capture_source(p_kind text,p_row jsonb) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare sid uuid; existing public.ph_credit_sources; candidates uuid[]; source_key text:=p_row->>'unique_id'; key text; owner_id uuid;
begin
  if nullif(source_key,'') is null then return null; end if;
  if p_kind='request_history' and lower(coalesce(p_row->>'req_status','')) not in ('complete','completed') then return null; end if;
  -- Direct recovery calls obey the same lock order as trigger-driven writes.
  -- This volatile function's subsequent SQL sees publication after any wait;
  -- read APIs continue using the lock-free stable assigned_rep function.
  perform 1 from public.app_dataset_revisions r where r.key='ph_customer_consignee_sales_reps' for share;
  perform pg_advisory_xact_lock(hashtextextended(p_kind||':'||source_key,694873));
  select * into existing from public.ph_credit_sources where source_kind=p_kind and source_id=source_key for update;
  owner_id:=coalesce(existing.assigned_rep_id,
    case when p_kind='request_history' then (select h.assigned_rep_id from public.ph_request_history h where h.unique_id=source_key) end,
    sales_private.assigned_rep(p_row));
  if existing.id is not null and existing.snapshot=p_row then
    if existing.assigned_rep_id is null and owner_id is not null then
      update public.ph_credit_sources set assigned_rep_id=owner_id,updated_at=now() where id=existing.id;
    end if;
    return existing.id;
  end if;
  key:=sales_private.customer_key(p_row);
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
  values(p_kind,source_key,key,owner_id,p_row,coalesce(cardinality(candidates)>0,false),coalesce(candidates,'{}'))
  on conflict(source_kind,source_id) do update set snapshot=excluded.snapshot,
    assigned_rep_id=coalesce(ph_credit_sources.assigned_rep_id,excluded.assigned_rep_id),
    revision=ph_credit_sources.revision+1,updated_at=now() returning id into sid;
  insert into sales_private.source_versions(source_id,revision,snapshot)
    select id,revision,snapshot from public.ph_credit_sources where id=sid;
  return sid;
end $$;

alter table public.ph_active_request
  add column customeridentityid text, add column customername text,
  add column consigneeidentityid text, add column consigneename text;
alter table public.ph_request_history
  add column customeridentityid text, add column customername text,
  add column consigneeidentityid text, add column consigneename text;

-- Append context to the current view, preserving inventory precedence and RLS.
do $$ declare definition text; begin
  definition:=rtrim(pg_get_viewdef('public.ph_active_request_live_rows'::regclass,true),E';\n ');
  execute 'create or replace view public.ph_active_request_live_rows with (security_invoker=true) as select v.*, a.customeridentityid,a.customername,a.consigneeidentityid,a.consigneename from ('
    ||definition||') v join public.ph_active_request a on a.unique_id=v.unique_id';
end $$;

-- Preserve vetted batch/option writers except for four optional context fields.
do $$ declare definition text; original text; signature regprocedure; begin
  signature:='private.insert_request_batch(uuid,jsonb,text)'::regprocedure;
  original:=pg_get_functiondef(signature);
  definition:=replace(original,'master_app_tab_assignment, request_source, client_batch_id, row_version',
    'master_app_tab_assignment, request_source, client_batch_id, row_version, customeridentityid, customername, consigneeidentityid, consigneename');
  definition:=replace(definition,'source_name, p_client_batch_id, 1',
    'source_name, p_client_batch_id, 1, entry->>''customeridentityid'', entry->>''customername'', entry->>''consigneeidentityid'', entry->>''consigneename''');
  if definition=original or position('entry->>''consigneeidentityid''' in definition)=0 then raise exception 'REQUEST_BATCH_CONTEXT_PATCH_FAILED'; end if;
  execute definition;
  signature:='public.append_request_options_v1(uuid,text,text,text[])'::regprocedure;
  original:=pg_get_functiondef(signature);
  definition:=replace(original,'master_app_tab_assignment, request_source, client_batch_id, row_version',
    'master_app_tab_assignment, request_source, client_batch_id, row_version, customeridentityid, customername, consigneeidentityid, consigneename');
  definition:=replace(definition,'candidate.app_tab_assignment, ''general'', p_client_batch_id, 1',
    'candidate.app_tab_assignment, ''general'', p_client_batch_id, 1, source_request.customeridentityid, source_request.customername, source_request.consigneeidentityid, source_request.consigneename');
  if definition=original or position('source_request.consigneeidentityid' in definition)=0 then raise exception 'REQUEST_OPTION_CONTEXT_PATCH_FAILED'; end if;
  execute definition;
end $$;

create or replace function sales_private.history_identity_trigger() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;
begin
  select to_jsonb(a) into context from public.ph_active_request a where a.unique_id=new.unique_id;
  new.customeridentityid:=coalesce(nullif(new.customeridentityid,''),nullif(new.snapshot->>'customeridentityid',''),nullif(new.snapshot->>'CUSTOMERIDENTITYID',''),nullif(context->>'customeridentityid',''));
  new.customername:=coalesce(nullif(new.customername,''),nullif(new.snapshot->>'customername',''),nullif(new.snapshot->>'CUSTOMERNAME',''),nullif(context->>'customername',''),nullif(new.req_customer,''),nullif(new.request_customer,''));
  new.consigneeidentityid:=coalesce(nullif(new.consigneeidentityid,''),nullif(new.snapshot->>'consigneeidentityid',''),nullif(new.snapshot->>'CONSIGNEEIDENTITYID',''),nullif(context->>'consigneeidentityid',''));
  new.consigneename:=coalesce(nullif(new.consigneename,''),nullif(new.snapshot->>'consigneename',''),nullif(new.snapshot->>'CONSIGNEENAME',''),nullif(context->>'consigneename',''));
  new.snapshot:=coalesce(new.snapshot,'{}')||jsonb_build_object('customeridentityid',new.customeridentityid,'customername',new.customername,'consigneeidentityid',new.consigneeidentityid,'consigneename',new.consigneename);
  new.assigned_rep_id:=coalesce(case when tg_op='UPDATE' then old.assigned_rep_id end,new.assigned_rep_id,sales_private.assigned_rep(new.snapshot||to_jsonb(new)));
  return new;
end $$;

-- Protect clean/upgrade installs BEFORE touching historical active rows.
-- Already-applied installations receive the same guard in the incremental
-- request_metadata_notification_guard migration; never rerun this backfill live.
create or replace function private.reconcile_request_folder_from_request_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- request-metadata-notification-guard-v1: compare business semantics only.
  -- Metadata, photos, timestamps and row versions are not completion actions.
  if tg_op = 'UPDATE' then
    if row(
      old.unique_id, btrim(coalesce(old.request_folder,'')),
      not coalesce(old.req_archived,false)
        and lower(btrim(coalesce(old.req_status,'pending'))) not in ('archived','cancelled','canceled'),
      lower(btrim(coalesce(old.req_status,''))) in ('complete','completed','done')
        or nullif(btrim(coalesce(old.date_completed,'')),'') is not null
    ) is not distinct from row(
      new.unique_id, btrim(coalesce(new.request_folder,'')),
      not coalesce(new.req_archived,false)
        and lower(btrim(coalesce(new.req_status,'pending'))) not in ('archived','cancelled','canceled'),
      lower(btrim(coalesce(new.req_status,''))) in ('complete','completed','done')
        or nullif(btrim(coalesce(new.date_completed,'')),'') is not null
    ) then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' then
    perform private.reconcile_request_folder_completion_v2(old.request_folder);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.request_folder is distinct from new.request_folder then
    perform private.reconcile_request_folder_completion_v2(old.request_folder);
  end if;
  perform private.reconcile_request_folder_completion_v2(new.request_folder);
  return new;
end
$function$;
revoke all on function private.reconcile_request_folder_from_request_v2() from public, anon, authenticated;

-- Legacy clients must use the same completion semantics as folder delivery.
-- Otherwise a spelling cleanup of an old "done" row can bypass the row guard.
create or replace function private.capture_legacy_request_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_is_complete boolean;
  old_was_complete boolean := false;
begin
  new_is_complete := lower(btrim(coalesce(new.req_status, ''))) in ('complete', 'completed', 'done')
    or nullif(btrim(coalesce(new.date_completed, '')), '') is not null;
  if not new_is_complete or new.client_batch_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    old_was_complete := lower(btrim(coalesce(old.req_status, ''))) in ('complete', 'completed', 'done')
      or nullif(btrim(coalesce(old.date_completed, '')), '') is not null;
  end if;
  if old_was_complete then
    return new;
  end if;
  perform private.upsert_request_history(new.unique_id, 'completed', 'pending', false);
  insert into public.ph_request_delivery_outbox (
    event_key, event_type, request_id, request_folder, payload, status
  ) values (
    'request-completed:' || new.unique_id || ':' || new.row_version::text,
    'request_completed', new.unique_id, new.request_folder,
    jsonb_build_object('request_id', new.unique_id, 'row_version', new.row_version,
                       'legacy_atomic_guard', true),
    'pending'
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;
revoke all on function private.capture_legacy_request_completion() from public, anon, authenticated;

-- Same-ID snapshots only: names never establish customer/consignee IDs.
update public.ph_active_request a set
  customeridentityid=coalesce(nullif(h.snapshot->>'customeridentityid',''),nullif(h.snapshot->>'CUSTOMERIDENTITYID','')),
  customername=coalesce(nullif(h.snapshot->>'customername',''),nullif(h.snapshot->>'CUSTOMERNAME',''),nullif(a.req_customer,'')),
  consigneeidentityid=coalesce(nullif(h.snapshot->>'consigneeidentityid',''),nullif(h.snapshot->>'CONSIGNEEIDENTITYID','')),
  consigneename=coalesce(nullif(h.snapshot->>'consigneename',''),nullif(h.snapshot->>'CONSIGNEENAME',''))
from public.ph_request_history h where a.unique_id=h.unique_id;
update public.ph_active_request set customername=nullif(req_customer,'') where customername is null and nullif(req_customer,'') is not null;
update public.ph_request_history set customername=customername;
select sales_private.refresh_rep_identities();
-- All retained invoices, without request-completion/delivery side effects.
select sales_private.capture_source('docks',to_jsonb(s)) from public.ph_soc_master s;

do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.request_history_command_v1(uuid,text,jsonb,uuid,bigint)'::regprocedure);
  definition:=replace(definition,'case when p_operation=''compatibility'' then ''all'' else ''completed'' end','''all''');
  definition:=replace(definition,'from source where sales_private.can_read_source(actor.id,rep)',
    'from source where sales_private.can_read_source(actor.id,rep) or sales_private.key(row->>''request_created_by_username'')=sales_private.key(actor.username)');
  definition:=replace(definition,'''assigned_rep_id'',rep,''status''',
    '''assigned_rep_id'',rep,''canRequestCredit'',public.navigation_module_allowed_v1(actor.id,''sales-credit'') and exists(select 1 from public.ph_credit_sources cs where cs.source_kind=''request_history'' and cs.source_id=row->>''unique_id'' and sales_private.can_read_source(actor.id,cs.assigned_rep_id) and (cs.canonical_source_id is null or exists(select 1 from public.ph_credit_sources canonical where canonical.id=cs.canonical_source_id and canonical.canonical_source_id is null and sales_private.can_read_source(actor.id,canonical.assigned_rep_id)))),''status''');
  definition:=replace(definition,'position(q in sales_private.key(row->>''commonname''))>0',
    'position(q in sales_private.key(concat_ws('' '',row->>''customername'',row->>''consigneename'',row->>''commonname'',row->>''itemcode'',row->>''request_folder'')))>0');
  definition:=replace(definition,'coalesce(row->>''consigneename'','''')','coalesce(nullif(row->>''consigneename'',''''),''Unknown consignee'')');
  execute definition;
end $$;

-- Existing writes/retries/reviews/attachments retain their audited implementation.
alter function public.sales_credit_command_v1(uuid,text,jsonb,uuid,bigint) set schema sales_private;
alter function sales_private.sales_credit_command_v1(uuid,text,jsonb,uuid,bigint) rename to credit_command_base_v1;

create function sales_private.credit_source_json(p_source public.ph_credit_sources,p_actor uuid,p_reviewer boolean)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(p_source)||jsonb_build_object('canResolve',p_reviewer,
    'canAuthorizeRepeat',p_reviewer and exists(select 1 from public.ph_sales_credit_requests c where c.source_id=p_source.id and c.credit_status in ('pending','approved')),
    'possibleMatches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'label',concat_ws(' / ',m.snapshot->>'itemcode',m.snapshot->>'dock',m.snapshot->>'stopnumber',m.snapshot->>'transactionnumber')))
      from public.ph_credit_sources m where m.id=any(p_source.possible_replacements) and sales_private.can_read_source(p_actor,m.assigned_rep_id)),'[]'::jsonb),
    'claims',coalesce((select jsonb_agg(jsonb_build_object('id',c.unique_id,'status',c.credit_status,'quantity',c.credit_qty,'submitted_at',c.submitted_at) order by c.submitted_at desc)
      from public.ph_sales_credit_requests c left join public.ph_credit_sources cs on cs.id=c.source_id
      where coalesce(cs.canonical_source_id,c.source_id)=p_source.id and sales_private.can_read_line(p_actor,c)),'[]'::jsonb))
$$;

create function public.sales_credit_command_v1(p_actor_id uuid,p_operation text,p_payload jsonb default '{}',p_command_id uuid default null,p_expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; reviewer boolean; result jsonb; src public.ph_credit_sources;
  kind text:=nullif(p_payload->>'sourceKind',''); q text:=sales_private.key(p_payload->>'query');
  lim integer:=least(100,greatest(1,coalesce((p_payload->>'limit')::integer,40)));
begin
  if p_operation not in ('folders','sources','source') then
    return sales_private.credit_command_base_v1(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
  end if;
  actor:=sales_private.actor(p_actor_id);
  perform sales_private.require_module(actor.id,'sales-credit');
  reviewer:=actor.username in ('dylan_collyge','jd_jones','megan_kelly');
  if kind is not null and kind not in ('docks','request_history') then raise exception 'CREDIT_SOURCE_KIND_INVALID'; end if;
  if p_operation='source' then
    if kind is null or nullif(p_payload->>'sourceUniqueId','') is null then raise exception 'CREDIT_SOURCE_ID_REQUIRED'; end if;
    select * into src from public.ph_credit_sources s where s.source_kind=kind and s.source_id=p_payload->>'sourceUniqueId'
      and sales_private.can_read_source(actor.id,s.assigned_rep_id);
    if src.id is null then raise exception using errcode='42501',message='CREDIT_SOURCE_FORBIDDEN'; end if;
    if src.canonical_source_id is not null then
      select * into src from public.ph_credit_sources s where s.id=src.canonical_source_id and s.canonical_source_id is null
        and sales_private.can_read_source(actor.id,s.assigned_rep_id);
      if src.id is null then raise exception using errcode='42501',message='CREDIT_SOURCE_FORBIDDEN'; end if;
    end if;
    return jsonb_build_object('source',sales_private.credit_source_json(src,actor.id,reviewer),'folder',jsonb_build_object(
      'customerKey',src.customer_key,'customername',coalesce(nullif(src.snapshot->>'customername',''),nullif(src.snapshot->>'req_customer',''),'Unknown customer'),
      'consigneename',coalesce(nullif(src.snapshot->>'consigneename',''),'Unknown consignee')));
  end if;
  if p_operation='folders' then
    with folders as (
      select customer_key,max(coalesce(nullif(snapshot->>'customername',''),nullif(snapshot->>'req_customer',''),nullif(snapshot->>'request_customer',''),'Unknown customer')) customer,
        max(coalesce(nullif(snapshot->>'consigneename',''),'Unknown consignee')) consignee,count(*) count
      from public.ph_credit_sources s where sales_private.can_read_source(actor.id,s.assigned_rep_id) and canonical_source_id is null
        and (kind is null or s.source_kind=kind)
        and (q='' or position(q in sales_private.key(concat_ws(' ',snapshot->>'customername',snapshot->>'req_customer',snapshot->>'consigneename',snapshot->>'itemcode',snapshot->>'commonname',snapshot->>'request_folder')))>0)
      group by customer_key having coalesce(p_payload#>>'{cursor,key}','')='' or customer_key>p_payload#>>'{cursor,key}' order by customer_key limit lim+1
    ) select jsonb_build_object('folders',coalesce((select jsonb_agg(jsonb_build_object('customerKey',customer_key,'customername',customer,'consigneename',consignee,'count',count) order by customer_key) from (select * from folders limit lim) f),'[]'),
      'nextCursor',case when (select count(*) from folders)>lim then (select jsonb_build_object('key',customer_key) from folders offset lim-1 limit 1) end) into result;
  else
    with visible as (
      select s.* from public.ph_credit_sources s where sales_private.can_read_source(actor.id,s.assigned_rep_id) and canonical_source_id is null
        and (kind is null or s.source_kind=kind)
        and (nullif(p_payload->>'customerKey','') is null or s.customer_key=p_payload->>'customerKey')
        and (q='' or position(q in sales_private.key(concat_ws(' ',snapshot->>'customername',snapshot->>'req_customer',snapshot->>'consigneename',snapshot->>'itemcode',snapshot->>'commonname',snapshot->>'request_folder')))>0)
        and (nullif(p_payload#>>'{cursor,id}','') is null or s.id>(p_payload#>>'{cursor,id}')::uuid) order by id limit lim+1
    ) select jsonb_build_object('rows',coalesce((select jsonb_agg(sales_private.credit_source_json(s::public.ph_credit_sources,actor.id,reviewer) order by s.id)
      from (select * from visible limit lim) s),'[]'::jsonb),
      'nextCursor',case when (select count(*) from visible)>lim then (select jsonb_build_object('id',id) from visible offset lim-1 limit 1) end) into result;
    if reviewer then result:=result||jsonb_build_object('requesters',coalesce((select jsonb_agg(jsonb_build_object('id',id,'username',username,'display_name',display_name) order by username) from public.profiles where disabled_at is null and not must_change_password),'[]'::jsonb)); end if;
  end if;
  return result;
end $$;

create function public.sales_history_unresolved_sources_v1() returns table(source_kind text,source_id text,salesrepid text,salesrepname text,selected_rep_username text)
language sql stable security definer set search_path='' as $$
  select s.source_kind,s.source_id,s.snapshot->>'salesrepid',s.snapshot->>'salesrepname',s.snapshot->>'request_selected_rep_username'
  from public.ph_credit_sources s where s.assigned_rep_id is null order by s.source_kind,s.source_id
$$;
revoke all on all functions in schema sales_private from public,anon,authenticated;
revoke all on function public.sales_credit_command_v1(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated;
revoke all on function public.sales_history_unresolved_sources_v1() from public,anon,authenticated;
grant execute on function public.sales_credit_command_v1(uuid,text,jsonb,uuid,bigint) to service_role;
grant execute on function public.sales_history_unresolved_sources_v1() to service_role;
notify pgrst,'reload schema';
commit;
