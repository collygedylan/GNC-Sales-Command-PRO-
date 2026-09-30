-- Convert domain conflicts away from serialization_failure so PostgREST does not internally retry forever.
-- Keep the public conflict message and function ACL/security contract unchanged.
create or replace function public.create_shear_location_inquiries_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  submission public.ph_shear_location_submissions;
  inquiry public.ph_shear_location_inquiries;
  item_row public.ph_shear_location_items;
  inventory_row public.ph_master_inventory;
  location_record record;
  decision_record record;
  recipient_record record;
  delivery public.ph_request_delivery_outbox;
  selections jsonb := coalesce(p_payload->'selections', '[]'::jsonb);
  recipients jsonb := coalesce(p_payload->'recipients', '[]'::jsonb);
  idempotency_value text := btrim(coalesce(p_payload->>'idempotencyKey', ''));
  recipient_profiles jsonb := '[]'::jsonb;
  recipient_usernames text[] := '{}'::text[];
  recipient_emails text[] := '{}'::text[];
  item_ordinal integer;
  row_ordinal integer;
  matched_selection_count integer;
  total_items integer;
  total_rows integer;
  total_on_hand_value numeric;
  review_total_value numeric;
  available_total_value numeric;
  total_to_shear_value integer;
  event_payload jsonb;
  result jsonb;
begin
  actor := private.shear_assert_active_actor_v1(p_payload->>'actorUsername');
  if actor.username <> 'dylan_collyge' then
    raise exception using errcode = '42501', message = 'shear_create_forbidden';
  end if;
  if length(idempotency_value) < 16 or length(idempotency_value) > 240
     or jsonb_typeof(selections) <> 'array' or jsonb_array_length(selections) < 1 or jsonb_array_length(selections) > 100
     or jsonb_typeof(recipients) <> 'array' or jsonb_array_length(recipients) < 1 or jsonb_array_length(recipients) > 50 then
    raise exception using errcode = '22023', message = 'shear_create_payload_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('shear-location:' || idempotency_value, 0));
  select * into submission from public.ph_shear_location_submissions where idempotency_key = idempotency_value;
  if submission.id is not null then
    if submission.created_by_username <> actor.username then
      raise exception using errcode = '42501', message = 'shear_idempotency_forbidden';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'locationcode', q.locationcode, 'status', q.status, 'revision', q.revision,
      'itemCount', q.item_count, 'rowCount', q.row_count, 'totalOnHand', q.total_on_hand,
      'totalToShear', q.total_to_shear, 'deliveryEventId', q.delivery_event_id
    ) order by q.location_key), '[]'::jsonb) into result
    from public.ph_shear_location_inquiries q where q.submission_id = submission.id;
    return jsonb_build_object('idempotentReplay', true, 'inquiries', result);
  end if;

  for recipient_record in
    select value as recipient from jsonb_array_elements(recipients)
  loop
    if not exists (
      select 1 from public.profiles p
      where p.id = nullif(recipient_record.recipient->>'profileId', '')::uuid
        and p.username = lower(btrim(recipient_record.recipient->>'username'))
        and p.disabled_at is null
        and (p.locked_until is null or p.locked_until <= now())
        and not coalesce(p.must_change_password, false)
    ) or lower(btrim(coalesce(recipient_record.recipient->>'email', ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'shear_recipient_invalid';
    end if;
    if lower(btrim(recipient_record.recipient->>'username')) = any(recipient_usernames) then
      raise exception using errcode = '22023', message = 'shear_recipient_duplicate';
    end if;
    recipient_profiles := recipient_profiles || jsonb_build_array(jsonb_build_object(
      'profileId', recipient_record.recipient->>'profileId',
      'username', lower(btrim(recipient_record.recipient->>'username')),
      'display', left(btrim(coalesce(recipient_record.recipient->>'display', recipient_record.recipient->>'username')), 200),
      'email', lower(btrim(recipient_record.recipient->>'email'))
    ));
    recipient_usernames := array_append(recipient_usernames, lower(btrim(recipient_record.recipient->>'username')));
    recipient_emails := array_append(recipient_emails, lower(btrim(recipient_record.recipient->>'email')));
  end loop;

  select count(*) into matched_selection_count
  from jsonb_array_elements(selections) selected
  join public.ph_master_inventory m on m.unique_id = btrim(selected->>'sourceUniqueId')
  where btrim(coalesce(m.itemcode, '')) <> '' and btrim(coalesce(m.locationcode, '')) <> ''
    and private.shear_numeric_v1(selected->>'percent') > 0
    and private.shear_numeric_v1(selected->>'percent') <= 100
    and lower(replace(btrim(coalesce(selected->>'shearType', '')), ' ', '_'))
      in ('shape_shear', 'saleable_shear', 'hard_shear', 'corrective_shear')
    and length(coalesce(selected->>'instructions', '')) <= 4000;
  if matched_selection_count <> jsonb_array_length(selections) then
    raise exception using errcode = 'PT409', message = 'shear_selection_refresh_required';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(selections) selected
    join public.ph_master_inventory m on m.unique_id = btrim(selected->>'sourceUniqueId')
    group by lower(btrim(m.locationcode)), lower(btrim(m.itemcode))
    having count(distinct concat_ws('|',
      private.shear_numeric_v1(selected->>'percent')::text,
      lower(replace(btrim(selected->>'shearType'), ' ', '_')),
      coalesce(selected->>'instructions', ''))) > 1
  ) then
    raise exception using errcode = '22023', message = 'shear_item_decision_conflict';
  end if;

  insert into public.ph_shear_location_submissions(idempotency_key, created_by_username, created_by_profile_id)
  values (idempotency_value, actor.username, actor.id) returning * into submission;

  for location_record in
    select lower(btrim(m.locationcode)) as location_key, min(btrim(m.locationcode)) as locationcode
    from jsonb_array_elements(selections) selected
    join public.ph_master_inventory m on m.unique_id = btrim(selected->>'sourceUniqueId')
    group by lower(btrim(m.locationcode))
    order by lower(btrim(m.locationcode))
  loop
    perform pg_advisory_xact_lock(hashtextextended('shear-active-location:' || location_record.location_key, 0));
    if exists (select 1 from public.ph_shear_location_inquiries q
      where q.location_key = location_record.location_key and q.status in ('open', 'in_progress')) then
      raise exception using errcode = 'PT409', message = 'shear_location_already_active';
    end if;
    insert into public.ph_shear_location_inquiries(
      submission_id, locationcode, recipient_profiles, recipient_usernames, recipient_emails,
      created_by_username, created_by_display
    ) values (
      submission.id, location_record.locationcode, recipient_profiles, recipient_usernames, recipient_emails,
      actor.username, coalesce(nullif(actor.display_name, ''), actor.username)
    ) returning * into inquiry;

    item_ordinal := 0;
    row_ordinal := 0;
    for decision_record in
      select lower(btrim(m.itemcode)) as itemcode_key,
        min(btrim(m.itemcode)) as itemcode,
        min(coalesce(m.commonname, '')) as commonname,
        min(private.shear_numeric_v1(selected->>'percent')) as percent_to_shear,
        min(lower(replace(btrim(selected->>'shearType'), ' ', '_'))) as shear_type,
        min(coalesce(selected->>'instructions', '')) as instructions
      from jsonb_array_elements(selections) selected
      join public.ph_master_inventory m on m.unique_id = btrim(selected->>'sourceUniqueId')
      where lower(btrim(m.locationcode)) = location_record.location_key
      group by lower(btrim(m.itemcode))
      order by lower(btrim(m.itemcode))
    loop
      item_ordinal := item_ordinal + 1;
      -- Lock the exact current membership before calculating totals so the
      -- frozen rows, PDF totals, and half-up quantities all describe one
      -- transactionally consistent inventory state.
      perform m.unique_id
      from public.ph_master_inventory m
      where lower(btrim(m.itemcode)) = decision_record.itemcode_key
        and lower(btrim(m.locationcode)) = location_record.location_key
      order by m.unique_id
      for update;
      select coalesce(sum(greatest(private.shear_numeric_v1(m.ptronhand), 0)), 0),
        coalesce(sum(greatest(private.shear_numeric_v1(m.ptrreviewed), 0)), 0),
        coalesce(sum(greatest(private.shear_numeric_v1(m.ptravailable), 0)), 0),
        count(*)
      into total_on_hand_value, review_total_value, available_total_value, matched_selection_count
      from public.ph_master_inventory m
      where lower(btrim(m.itemcode)) = decision_record.itemcode_key
        and lower(btrim(m.locationcode)) = location_record.location_key;

      insert into public.ph_shear_location_items(
        inquiry_id, itemcode, commonname, percent_to_shear, shear_type, instructions,
        on_hand_total, review_total, available_total, calculated_quantity, ordinal
      ) values (
        inquiry.id, decision_record.itemcode, decision_record.commonname,
        decision_record.percent_to_shear, decision_record.shear_type, decision_record.instructions,
        total_on_hand_value, review_total_value, available_total_value,
        floor((total_on_hand_value * decision_record.percent_to_shear / 100) + 0.5)::integer,
        item_ordinal
      ) returning * into item_row;

      for inventory_row in
        select m.* from public.ph_master_inventory m
        where lower(btrim(m.itemcode)) = decision_record.itemcode_key
          and lower(btrim(m.locationcode)) = location_record.location_key
        order by coalesce(m.season, ''), coalesce(m.lotcode, ''), m.unique_id
        for update
      loop
        row_ordinal := row_ordinal + 1;
        insert into public.ph_shear_location_rows(
          inquiry_id, item_id, origin_unique_id, itemcode, commonname, contsize, locationcode,
          lotcode, season, salesyear, blockalpha, blocknumber, ptronhand, ptrreviewed,
          ptravailable, assignedto, priority, holdstopcode, holdstopreason, locationnote,
          locationnotedate, source, ordinal
        ) values (
          inquiry.id, item_row.id, inventory_row.unique_id, inventory_row.itemcode,
          coalesce(inventory_row.commonname, ''), coalesce(inventory_row.contsize, ''), inventory_row.locationcode,
          coalesce(inventory_row.lotcode, ''), coalesce(inventory_row.season, ''), coalesce(inventory_row.saleyear, ''),
          coalesce(inventory_row.blockalpha, ''), coalesce(inventory_row.blocknumber, ''),
          greatest(private.shear_numeric_v1(inventory_row.ptronhand), 0),
          greatest(private.shear_numeric_v1(inventory_row.ptrreviewed), 0),
          greatest(private.shear_numeric_v1(inventory_row.ptravailable), 0),
          coalesce(inventory_row.assignedto, ''), coalesce(inventory_row.priority, ''),
          coalesce(inventory_row.holdstopcode, ''), coalesce(inventory_row.holdstopreason, ''),
          coalesce(inventory_row.locationnote, ''), coalesce(inventory_row.locationnotedate, ''),
          coalesce(inventory_row.source, ''), row_ordinal
        );
      end loop;
    end loop;

    select count(*), coalesce(sum(i.on_hand_total), 0), coalesce(sum(i.calculated_quantity), 0)
      into total_items, total_on_hand_value, total_to_shear_value
    from public.ph_shear_location_items i where i.inquiry_id = inquiry.id;
    select count(*) into total_rows from public.ph_shear_location_rows r where r.inquiry_id = inquiry.id;
    if total_items < 1 or total_rows < 1 or total_rows > 2000 then
      raise exception using errcode = 'PT409', message = 'shear_location_membership_invalid';
    end if;
    update public.ph_shear_location_inquiries set
      item_count = total_items, row_count = total_rows,
      total_on_hand = total_on_hand_value, total_to_shear = total_to_shear_value,
      updated_at = now()
    where id = inquiry.id returning * into inquiry;

    select jsonb_build_object(
      'contractVersion', 'shear-location-inquiry-v1',
      'deliveryKind', 'created',
      'inquiryId', inquiry.id,
      'locationcode', inquiry.locationcode,
      'createdByUsername', inquiry.created_by_username,
      'createdByDisplay', inquiry.created_by_display,
      'createdAt', inquiry.created_at,
      'recipientProfiles', inquiry.recipient_profiles,
      'recipientEmails', to_jsonb(inquiry.recipient_emails),
      'itemCount', inquiry.item_count,
      'rowCount', inquiry.row_count,
      'totalOnHand', inquiry.total_on_hand,
      'totalToShear', inquiry.total_to_shear,
      'items', coalesce(jsonb_agg(
        jsonb_build_object(
          'itemcode', i.itemcode, 'commonname', i.commonname,
          'percentToShear', i.percent_to_shear, 'shearType', i.shear_type,
          'instructions', i.instructions, 'onHandTotal', i.on_hand_total,
          'reviewTotal', i.review_total, 'availableTotal', i.available_total,
          'calculatedQuantity', i.calculated_quantity,
          'rows', (select coalesce(jsonb_agg(jsonb_build_object(
            'originUniqueId', r.origin_unique_id, 'itemcode', r.itemcode, 'commonname', r.commonname,
            'contsize', r.contsize, 'locationcode', r.locationcode, 'lotcode', r.lotcode,
            'season', r.season, 'salesyear', r.salesyear, 'blockalpha', r.blockalpha,
            'blocknumber', r.blocknumber, 'ptronhand', r.ptronhand, 'ptrreviewed', r.ptrreviewed,
            'ptravailable', r.ptravailable, 'assignedto', r.assignedto, 'priority', r.priority,
            'holdstopcode', r.holdstopcode, 'holdstopreason', r.holdstopreason,
            'locationnote', r.locationnote, 'locationnotedate', r.locationnotedate,
            'source', r.source
          ) order by r.ordinal), '[]'::jsonb) from public.ph_shear_location_rows r where r.item_id = i.id)
        ) order by i.ordinal
      ), '[]'::jsonb)
    ) into event_payload
    from public.ph_shear_location_items i where i.inquiry_id = inquiry.id;

    insert into public.ph_request_delivery_outbox(
      event_key, event_type, request_id, request_folder, payload, status, next_attempt_at
    ) values (
      'shear-location:' || inquiry.id::text || ':created:v1', 'shear_location_inquiry',
      inquiry.id::text, inquiry.locationcode, event_payload, 'pending', now()
    ) on conflict (event_key) do update set payload = excluded.payload, updated_at = now()
    returning * into delivery;
    update public.ph_shear_location_inquiries set delivery_event_id = delivery.event_id
      where id = inquiry.id returning * into inquiry;
    insert into public.ph_shear_location_events(inquiry_id, event_type, actor_username, revision, metadata)
    values (inquiry.id, 'created', actor.username, inquiry.revision,
      jsonb_build_object('itemCount', inquiry.item_count, 'rowCount', inquiry.row_count,
        'deliveryEventId', inquiry.delivery_event_id));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'locationcode', q.locationcode, 'status', q.status, 'revision', q.revision,
    'itemCount', q.item_count, 'rowCount', q.row_count, 'totalOnHand', q.total_on_hand,
    'totalToShear', q.total_to_shear, 'deliveryEventId', q.delivery_event_id
  ) order by q.location_key), '[]'::jsonb) into result
  from public.ph_shear_location_inquiries q where q.submission_id = submission.id;
  return jsonb_build_object('idempotentReplay', false, 'inquiries', result);
exception
  when unique_violation then
    raise exception using errcode = 'PT409', message = 'shear_location_already_active';
end
$function$;

-- Mark the known singleton row explicitly for installations with safe-update enforcement.
create or replace function public.refresh_photo_history_catalog_v1(p_dry_run boolean default false)
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
    indexed_at=now()
  where ph_photo_history_assets.storage_available is distinct from excluded.storage_available
    or (excluded.drive_file_id is not null and ph_photo_history_assets.drive_file_id is distinct from excluded.drive_file_id)
    or (excluded.contexts<>'[]' and ph_photo_history_assets.contexts is distinct from excluded.contexts);
  get diagnostics changed=row_count;
  update public.ph_photo_history_assets a set storage_available=false,indexed_at=now()
  where a.storage_available and not exists(select 1 from storage.objects o where o.bucket_id=a.bucket and o.name=a.path);
  update public.ph_photo_history_index_state set refreshed_at=now(),asset_count=(select count(*) from public.ph_photo_history_assets) where singleton = true;
  return jsonb_build_object('ok',true,'status','refreshed','indexed',changed,'metadataOnly',true);
end $$;

