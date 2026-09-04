-- Future sends only. Preserve delivered events, frozen recipient lists and retry tokens.
create or replace function public.photo_history_gallery_v1(p_actor_id uuid,p_operation text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='12s' as $$
declare
  result jsonb; photos jsonb; recipient record; asset public.ph_photo_history_assets%rowtype;
  saved public.ph_photo_history_shares%rowtype; ev public.ph_request_delivery_outbox%rowtype;
  ids uuid[]; token text; fingerprint text; share_id uuid; event_id uuid;
  required_copies jsonb; recipient_emails jsonb;
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
    where lower(regexp_replace(p.role,'^[[:space:]]+|[[:space:]]+$','','g')) in ('rep','salesrep','sales rep') and p.disabled_at is null and not p.must_change_password
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
      and lower(regexp_replace(p.role,'^[[:space:]]+|[[:space:]]+$','','g')) in ('rep','salesrep','sales rep') and p.disabled_at is null and not p.must_change_password
      and (p.locked_until is null or p.locked_until<=now()) and u.email_confirmed_at is not null
      and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
    if recipient.id is null then raise exception 'PHOTO_HISTORY_RECIPIENT_UNAVAILABLE'; end if;
    -- Required copies are resolved from verified active profiles, never browser addresses.
    select jsonb_agg(jsonb_build_object('username',lower(btrim(p.username)),'email',lower(btrim(u.email)))
      order by lower(btrim(p.username))) into required_copies
    from public.profiles p join auth.users u on u.id=p.id
    where lower(btrim(p.username)) in ('dylan_collyge','jd_jones')
      and p.disabled_at is null and not p.must_change_password
      and (p.locked_until is null or p.locked_until<=now()) and u.email_confirmed_at is not null
      and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
    if coalesce(jsonb_array_length(required_copies),0)<>2 then
      raise exception 'PHOTO_HISTORY_REQUIRED_COPY_UNAVAILABLE';
    end if;
    select jsonb_agg(email order by email) into recipient_emails from (
      select recipient.email as email union select c->>'email' from jsonb_array_elements(required_copies)c
    ) recipients;
    -- Freeze the authoritative catalog references, never browser URLs or recipient addresses.
    select jsonb_agg(jsonb_build_object('id',a.id,'bucket',a.bucket,'path',a.path,'filename',a.filename,
      'date',a.photo_at,'commonname',a.commonname,'itemcode',a.itemcode,'contsize',a.contsize,
      'locationcode',a.locationcode,'lotcode',a.lotcode,'storageAvailable',a.storage_available,'driveFileId',a.drive_file_id)
      order by a.photo_at desc,a.id desc) into photos from public.ph_photo_history_assets a
    where a.id=any(ids) and (a.storage_available or a.drive_file_id is not null);
    if coalesce(jsonb_array_length(photos),0)<>cardinality(ids) then raise exception 'PHOTO_HISTORY_ASSET_UNAVAILABLE'; end if;
    share_id:=gen_random_uuid();
    insert into public.ph_request_delivery_outbox(event_key,event_type,payload)
    values('photo-history:'||share_id,'photo_history_share',jsonb_build_object('contractVersion','photo-history-share-v2',
      'shareId',share_id,'actorUsername','dylan_collyge','recipientEmails',recipient_emails,
      'selectedRecipientEmail',recipient.email,'requiredCopies',required_copies,
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
      (select h.id,h.created_at,h.photo_count,h.recipient_name,
        case when o.payload->>'contractVersion'='photo-history-share-v2' then jsonb_build_array('dylan_collyge','jd_jones') else '[]'::jsonb end as copied_usernames,
        o.status,(o.email_delivered_at is not null or o.status='delivered') delivered
      from public.ph_photo_history_shares h join public.ph_request_delivery_outbox o on o.event_id=h.event_id
      where h.actor_id=p_actor_id and h.dismissed_at is null order by h.created_at desc limit 40)s;
    return result;
  end if;
  raise exception 'PHOTO_HISTORY_OPERATION_INVALID';
end $$;
revoke all on function public.photo_history_gallery_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.photo_history_gallery_v1(uuid,text,jsonb) to service_role;
