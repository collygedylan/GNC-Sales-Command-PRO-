-- Metadata only. Never copies, updates or deletes a historical photo or plant row.
create table public.ph_photo_history_assets (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  bucket text not null,
  path text not null,
  filename text not null,
  photo_at timestamptz not null,
  itemcode text not null default '',
  commonname text not null default '',
  contsize text not null default '',
  locationcode text not null default '',
  lotcode text not null default '',
  contexts jsonb not null default '[]',
  search_text text not null default '',
  storage_available boolean not null default true,
  drive_file_id text,
  indexed_at timestamptz not null default now()
);
create index ph_photo_history_cursor on public.ph_photo_history_assets(photo_at desc, id desc);
create index ph_photo_history_search on public.ph_photo_history_assets using gin(search_text extensions.gin_trgm_ops);
create index ph_photo_history_contexts on public.ph_photo_history_assets using gin(contexts jsonb_path_ops);
create table public.ph_photo_history_index_state (
  singleton boolean primary key default true check(singleton),
  refreshed_at timestamptz,
  asset_count bigint not null default 0
);
insert into public.ph_photo_history_index_state(singleton) values(true);
create table public.ph_photo_history_shares (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  idempotency_key text not null,
  fingerprint text not null,
  event_id uuid not null references public.ph_request_delivery_outbox(event_id),
  photo_count integer not null check(photo_count between 1 and 20),
  recipient_name text not null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  unique(actor_id,idempotency_key)
);
create table public.ph_photo_history_audit (
  id bigint generated always as identity primary key,
  share_id uuid references public.ph_photo_history_shares(id),
  event text not null check(event in ('created','retry','dismissed')),
  created_at timestamptz not null default now()
);
alter table public.ph_photo_history_assets enable row level security;
alter table public.ph_photo_history_index_state enable row level security;
alter table public.ph_photo_history_shares enable row level security;
alter table public.ph_photo_history_audit enable row level security;
revoke all on public.ph_photo_history_assets,public.ph_photo_history_index_state,
 public.ph_photo_history_shares,public.ph_photo_history_audit from public,anon,authenticated;
grant select,insert,update on public.ph_photo_history_assets,public.ph_photo_history_index_state,
 public.ph_photo_history_shares to service_role;
grant select,insert on public.ph_photo_history_audit to service_role;
grant usage,select on sequence public.ph_photo_history_audit_id_seq to service_role;

create function private.photo_history_require_dylan_v1(p_actor_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_service_role_request() or not exists (
    select 1 from public.profiles p where p.id=p_actor_id
      and lower(btrim(p.username))='dylan_collyge' and p.disabled_at is null
      and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password
  ) then raise exception using errcode='42501',message='PHOTO_HISTORY_FORBIDDEN'; end if;
end $$;
revoke all on function private.photo_history_require_dylan_v1(uuid) from public,anon,authenticated;

create function public.refresh_photo_history_catalog_v1(p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='45s' as $$
declare n bigint; changed bigint;
begin
  if not private.is_service_role_request() then
    raise exception using errcode='42501',message='PHOTO_HISTORY_FORBIDDEN'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('photo-history-index-v1',0)) then
    return jsonb_build_object('ok',true,'status','busy'); end if;
  select count(*) into n from storage.objects where bucket_id in
    ('request_photos','flyer_photos','season_sales_notes_photos','location_sales_notes_photos')
    and name !~ '^_thumbs/' and name ~* '\.(jpe?g|png|webp|heic|heif)$';
  if p_dry_run then return jsonb_build_object('ok',true,'sourcePhotoCount',n,'metadataOnly',true); end if;
  if exists(select 1 from public.ph_photo_history_index_state where refreshed_at>now()-interval '15 minutes') then
    return jsonb_build_object('ok',true,'status','fresh','sourcePhotoCount',n); end if;
  with source_rows as materialized (
    select to_jsonb(m) j from public.ph_master_inventory m
    union all select to_jsonb(a) from public.ph_active_request a
    union all select coalesce(h.snapshot,'{}'::jsonb)||jsonb_strip_nulls(to_jsonb(h)) from public.ph_request_history h
    union all select coalesce(f.snapshot,'{}'::jsonb)||jsonb_strip_nulls(to_jsonb(f)) from public.ph_flyer_folder_history f
    union all select coalesce(p.snapshot,'{}'::jsonb)||jsonb_strip_nulls(to_jsonb(p)) from public.ph_productivity_history p
  ), refs as materialized (
    select split_part(regexp_replace(btrim(u), '^https://[^/]+/storage/v1/(object|render/image)/public/', ''),'?',1) source_key,
      jsonb_build_object('itemcode',coalesce(j->>'itemcode',''),'commonname',coalesce(j->>'commonname',''),
       'contsize',coalesce(j->>'contsize',''),'locationcode',coalesce(j->>'locationcode',''),'lotcode',coalesce(j->>'lotcode','')) context
    from source_rows cross join lateral regexp_split_to_table(concat_ws(',',j->>'photo_link',j->>'req_photo_link',j->>'flyer_photo_link'),E'[,\n]+') u
    where u ~ '^https://[^/]+/storage/v1/(object|render/image)/public/'
  ), reference_groups as (
    select source_key,jsonb_agg(distinct context) contexts from refs group by source_key
  ), objects as (
    select o.bucket_id bucket,o.name path,o.created_at photo_at,true storage_available,a.drive_file_id,
      a.drive_file_name from storage.objects o left join public.ph_photo_archive_jobs a
      on a.source_bucket=o.bucket_id and a.source_path=o.name
    where o.bucket_id in ('request_photos','flyer_photos','season_sales_notes_photos','location_sales_notes_photos')
      and o.name !~ '^_thumbs/' and o.name ~* '\.(jpe?g|png|webp|heic|heif)$'
    union all
    select a.source_bucket,a.source_path,coalesce(a.source_created_at,a.created_at),false,a.drive_file_id,a.drive_file_name
    from public.ph_photo_archive_jobs a where nullif(a.drive_file_id,'') is not null and a.verified_at is not null
      and a.source_bucket in ('request_photos','flyer_photos','season_sales_notes_photos','location_sales_notes_photos')
      and not exists(select 1 from storage.objects o where o.bucket_id=a.source_bucket and o.name=a.source_path)
  ), catalog as (
    select o.*,o.bucket||'/'||o.path source_key,
      coalesce(r.contexts,'[]') contexts,
      coalesce((select c from jsonb_array_elements(r.contexts)c order by
         (nullif(c->>'commonname','') is not null) desc,c->>'commonname',c->>'itemcode',c->>'locationcode',c->>'lotcode' limit 1),'{}') c,
      regexp_replace(o.path,'^.*/','') filename
    from objects o left join reference_groups r on r.source_key=o.bucket||'/'||o.path
  )
  insert into public.ph_photo_history_assets(source_key,bucket,path,filename,photo_at,itemcode,commonname,contsize,
    locationcode,lotcode,contexts,search_text,storage_available,drive_file_id)
  select source_key,bucket,path,filename,photo_at,coalesce(c->>'itemcode',''),coalesce(c->>'commonname',''),
    coalesce(c->>'contsize',''),coalesce(c->>'locationcode',''),coalesce(c->>'lotcode',''),contexts,
    lower(concat_ws(' ',filename,drive_file_name,contexts::text))||' '||regexp_replace(lower(concat_ws(' ',filename,contexts::text)),'[^a-z0-9]','','g'),
    storage_available,drive_file_id from catalog
  on conflict(source_key) do update set
    storage_available=excluded.storage_available,drive_file_id=coalesce(excluded.drive_file_id,ph_photo_history_assets.drive_file_id),
    -- Retain known plant labels when a historical source row is subsequently removed.
    itemcode=coalesce(nullif(excluded.itemcode,''),ph_photo_history_assets.itemcode),
    commonname=coalesce(nullif(excluded.commonname,''),ph_photo_history_assets.commonname),
    contsize=coalesce(nullif(excluded.contsize,''),ph_photo_history_assets.contsize),
    locationcode=coalesce(nullif(excluded.locationcode,''),ph_photo_history_assets.locationcode),
    lotcode=coalesce(nullif(excluded.lotcode,''),ph_photo_history_assets.lotcode),
    contexts=case when excluded.contexts='[]' then ph_photo_history_assets.contexts else excluded.contexts end,
    search_text=case when excluded.contexts='[]' then ph_photo_history_assets.search_text else excluded.search_text end,
    indexed_at=now();
  get diagnostics changed=row_count;
  update public.ph_photo_history_index_state set refreshed_at=now(),asset_count=(select count(*) from public.ph_photo_history_assets);
  return jsonb_build_object('ok',true,'status','refreshed','indexed',changed,'metadataOnly',true);
end $$;
revoke all on function public.refresh_photo_history_catalog_v1(boolean) from public,anon,authenticated;
grant execute on function public.refresh_photo_history_catalog_v1(boolean) to service_role;

create function public.photo_history_gallery_v1(p_actor_id uuid,p_operation text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='12s' as $$
declare
  result jsonb; photos jsonb; recipient record; asset public.ph_photo_history_assets%rowtype;
  saved public.ph_photo_history_shares%rowtype; ev public.ph_request_delivery_outbox%rowtype;
  ids uuid[]; token text; fingerprint text; share_id uuid; event_id uuid;
  q text; page_size integer; cursor_at timestamptz; cursor_id uuid; as_of timestamptz;
begin
  perform private.photo_history_require_dylan_v1(p_actor_id);
  if p_operation='search' then
    q:=regexp_replace(lower(left(btrim(coalesce(p_input->>'q','')),120)),'[^a-z0-9]','','g');
    page_size:=least(48,greatest(1,coalesce((p_input->>'limit')::int,36)));
    cursor_at:=nullif(p_input#>>'{cursor,at}','')::timestamptz;
    cursor_id:=nullif(p_input#>>'{cursor,id}','')::uuid;
    as_of:=coalesce(nullif(p_input->>'asOf','')::timestamptz,now());
    with matches as (
      select a.* from public.ph_photo_history_assets a
      where a.photo_at<=as_of and (a.storage_available or a.drive_file_id is not null)
        and (q='' or a.search_text like '%'||q||'%')
        and (nullif(p_input->>'from','') is null or a.photo_at >= (p_input->>'from')::date)
        and (nullif(p_input->>'to','') is null or a.photo_at < (p_input->>'to')::date+interval '1 day')
        and (coalesce(p_input->>'container','')='' or exists(select 1 from jsonb_array_elements(a.contexts)c
             where lower(c->>'contsize')=lower(p_input->>'container')))
        and (coalesce(p_input->>'location','')='' or exists(select 1 from jsonb_array_elements(a.contexts)c
             where upper(c->>'locationcode')=upper(p_input->>'location')))
        and (coalesce(p_input->>'lot','')='' or exists(select 1 from jsonb_array_elements(a.contexts)c
             where upper(c->>'lotcode')=upper(p_input->>'lot')))
        and (cursor_at is null or (a.photo_at,a.id)<(cursor_at,cursor_id))
      order by a.photo_at desc,a.id desc limit page_size+1
    )
    select jsonb_build_object('ok',true,'asOf',as_of,'hasMore',count(*)>page_size,
      'photos',coalesce((select jsonb_agg(to_jsonb(p) order by p.photo_at desc,p.id desc) from
        (select id,filename,photo_at,itemcode,commonname,contsize,locationcode,lotcode,contexts,bucket,path,storage_available
          from matches order by photo_at desc,id desc limit page_size)p),'[]'),
      'indexedAt',(select refreshed_at from public.ph_photo_history_index_state)) into result from matches;
    return result;
  elsif p_operation='recipients' then
    select jsonb_build_object('ok',true,'recipients',coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',
      coalesce(nullif(p.display_name,''),p.username)) order by p.display_name,p.username),'[]')) into result
    from public.profiles p join auth.users u on u.id=p.id
    where lower(btrim(p.role)) in ('rep','salesrep','sales rep') and p.disabled_at is null and not p.must_change_password
      and (p.locked_until is null or p.locked_until<=now()) and u.email_confirmed_at is not null
      and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
    return result;
  elsif p_operation='asset' then
    select * into asset from public.ph_photo_history_assets where id=(p_input->>'id')::uuid;
    if not found then raise exception 'PHOTO_HISTORY_ASSET_UNAVAILABLE'; end if;
    return jsonb_build_object('ok',true,'asset',to_jsonb(asset));
  elsif p_operation='send' then
    token:=btrim(coalesce(p_input->>'idempotencyKey',''));
    if length(token)<16 or length(token)>160 then raise exception 'PHOTO_HISTORY_TOKEN_INVALID'; end if;
    if jsonb_typeof(p_input->'ids') is distinct from 'array' or jsonb_array_length(p_input->'ids') not between 1 and 20
      or length(coalesce(p_input->>'message',''))>2000 then raise exception 'PHOTO_HISTORY_SELECTION_INVALID'; end if;
    select array_agg(distinct x::uuid order by x::uuid) into ids from jsonb_array_elements_text(p_input->'ids')x;
    fingerprint:=encode(extensions.digest(jsonb_build_object('ids',ids,'rep',p_input->>'recipientId','message',coalesce(p_input->>'message',''))::text,'sha256'),'hex');
    if not pg_try_advisory_xact_lock(hashtextextended('photo-history-send:'||p_actor_id||':'||token,0)) then
      return jsonb_build_object('ok',false,'code','PHOTO_HISTORY_BUSY'); end if;
    select * into saved from public.ph_photo_history_shares where actor_id=p_actor_id and idempotency_key=token;
    if found then
      if saved.fingerprint<>fingerprint then raise exception 'PHOTO_HISTORY_TOKEN_CONFLICT'; end if;
      return jsonb_build_object('ok',true,'id',saved.id,'duplicate',true);
    end if;
    select p.id,coalesce(nullif(p.display_name,''),p.username) name,lower(btrim(u.email)) email into recipient
    from public.profiles p join auth.users u on u.id=p.id where p.id=(p_input->>'recipientId')::uuid
      and lower(btrim(p.role)) in ('rep','salesrep','sales rep') and p.disabled_at is null and not p.must_change_password
      and (p.locked_until is null or p.locked_until<=now()) and u.email_confirmed_at is not null
      and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
    if recipient.id is null then raise exception 'PHOTO_HISTORY_RECIPIENT_UNAVAILABLE'; end if;
    -- Freeze the authoritative catalog references, never browser URLs or recipient addresses.
    select jsonb_agg(jsonb_build_object('id',a.id,'bucket',a.bucket,'path',a.path,'filename',a.filename,
      'date',a.photo_at,'commonname',a.commonname,'itemcode',a.itemcode,'contsize',a.contsize,
      'locationcode',a.locationcode,'lotcode',a.lotcode,'storageAvailable',a.storage_available,'driveFileId',a.drive_file_id)
      order by a.photo_at desc,a.id desc) into photos from public.ph_photo_history_assets a
    where a.id=any(ids) and (a.storage_available or a.drive_file_id is not null);
    if coalesce(jsonb_array_length(photos),0)<>cardinality(ids) then raise exception 'PHOTO_HISTORY_ASSET_UNAVAILABLE'; end if;
    share_id:=gen_random_uuid();
    insert into public.ph_request_delivery_outbox(event_key,event_type,payload)
    values('photo-history:'||share_id,'photo_history_share',jsonb_build_object('contractVersion','photo-history-share-v1',
      'shareId',share_id,'actorUsername','dylan_collyge','recipientEmails',jsonb_build_array(recipient.email),
      'recipientName',recipient.name,'message',coalesce(p_input->>'message',''),'photos',photos)) returning ph_request_delivery_outbox.event_id into event_id;
    insert into public.ph_photo_history_shares(id,actor_id,idempotency_key,fingerprint,event_id,photo_count,recipient_name)
      values(share_id,p_actor_id,token,fingerprint,event_id,cardinality(ids),recipient.name);
    insert into public.ph_photo_history_audit(share_id,event) values(share_id,'created');
    return jsonb_build_object('ok',true,'id',share_id,'duplicate',false);
  elsif p_operation in ('status','retry','dismiss') then
    if p_operation<>'status' then
      select * into saved from public.ph_photo_history_shares where id=(p_input->>'id')::uuid and actor_id=p_actor_id for update;
      if not found then raise exception 'PHOTO_HISTORY_SHARE_MISSING'; end if;
      select * into ev from public.ph_request_delivery_outbox where ph_request_delivery_outbox.event_id=saved.event_id for update;
      if p_operation='retry' then
        if ev.status='delivered' or ev.email_delivered_at is not null then return jsonb_build_object('ok',true,'status','delivered'); end if;
        if ev.status not in ('failed','unknown') then return jsonb_build_object('ok',true,'status',ev.status); end if;
        update public.ph_request_delivery_outbox set status='pending',next_attempt_at=now(),sanitized_error_code=null,
          lease_token=null,lease_owner=null,lease_expires_at=null where ph_request_delivery_outbox.event_id=saved.event_id;
        insert into public.ph_photo_history_audit(share_id,event) values(saved.id,'retry');
      else
        if ev.status not in ('delivered','failed','unknown') then raise exception 'PHOTO_HISTORY_NOT_TERMINAL'; end if;
        update public.ph_photo_history_shares set dismissed_at=now() where id=saved.id;
        insert into public.ph_photo_history_audit(share_id,event) values(saved.id,'dismissed');
      end if;
    end if;
    select jsonb_build_object('ok',true,'shares',coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc),'[]')) into result from
      (select h.id,h.created_at,h.photo_count,h.recipient_name,o.status,(o.email_delivered_at is not null or o.status='delivered') delivered
      from public.ph_photo_history_shares h join public.ph_request_delivery_outbox o on o.event_id=h.event_id
      where h.actor_id=p_actor_id and h.dismissed_at is null order by h.created_at desc limit 40)s;
    return result;
  end if;
  raise exception 'PHOTO_HISTORY_OPERATION_INVALID';
end $$;
revoke all on function public.photo_history_gallery_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.photo_history_gallery_v1(uuid,text,jsonb) to service_role;
