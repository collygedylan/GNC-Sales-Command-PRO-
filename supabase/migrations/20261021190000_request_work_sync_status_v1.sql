begin;
-- Complete against the locked operational request, independent of ERP snapshot revisions.
CREATE OR REPLACE FUNCTION public.save_request_work(request_id text, expected_version bigint, patch jsonb, complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  existing public.ph_active_request%rowtype;
  profile public.profiles%rowtype;
  profile_email text;
  canonical jsonb;
  safe_patch jsonb;
  save_result jsonb;
  season_result jsonb;
  linked_itemcode text;
  resulting_version bigint;
  season_token text;
begin
  if not private.can_save_request_work() then
    raise exception using errcode = '42501', message = 'REQUEST_SAVE_FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(request_id, '')), '') is null or expected_version is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_AND_VERSION_REQUIRED';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception using errcode = '22023', message = 'REQUEST_PATCH_INVALID';
  end if;

  select * into existing
  from public.ph_active_request
  where unique_id = request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_NOT_FOUND';
  end if;

  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'REQUEST_PROFILE_REQUIRED';
  end if;
  if lower(btrim(coalesce(profile.username, ''))) in ('ben_brown', 'chance_alldredge') then
    if not private.can_work_request_identity(
      existing.request_created_by_username,
      existing.request_selected_rep_username,
      existing.requested_by
    ) then
      raise exception using errcode = '42501', message = 'REQUEST_ROW_FORBIDDEN';
    end if;
  end if;

  if lower(coalesce(existing.req_status, '')) in ('complete', 'completed')
     or nullif(btrim(coalesce(existing.date_completed, '')), '') is not null then
    canonical := coalesce(private.canonical_request_json(request_id), to_jsonb(existing));
    save_result := jsonb_build_object(
      'row', canonical,
      'row_version', existing.row_version,
      'delivery_state', coalesce((
        select outbox.status
        from public.ph_request_delivery_outbox outbox
        where outbox.request_id = existing.unique_id
          and outbox.event_type = 'request_completed'
        order by outbox.created_at desc
        limit 1
      ), 'already_completed'),
      'acknowledged', true
    );
  else
    if complete then expected_version := existing.row_version; end if;
    if existing.row_version <> expected_version then
      raise exception using errcode = 'PT409', message = 'REQUEST_VERSION_CONFLICT',
        detail = jsonb_build_object('current_version', existing.row_version)::text;
    end if;

    safe_patch := patch - 'completed_by_username' - 'completed_by_display' - 'completed_by_email';
    if complete then
      select auth_user.email into profile_email
      from auth.users auth_user
      where auth_user.id = profile.id;
      safe_patch := safe_patch || jsonb_build_object(
        'completed_by_username', profile.username,
        'completed_by_display', coalesce(nullif(profile.display_name, ''), profile.username),
        'completed_by_email', coalesce(profile_email, '')
      );
    end if;

    save_result := public.save_request_work_v1(
      request_id, expected_version, safe_patch, complete
    );
  end if;

  if coalesce(complete, false) and existing.master_id is not null then
    select master.itemcode into linked_itemcode
    from public.ph_master_inventory master
    where master.unique_id = existing.master_id;
    if nullif(btrim(coalesce(linked_itemcode, '')), '') is not null then
      resulting_version := coalesce(
        nullif(save_result->>'row_version', '')::bigint,
        existing.row_version
      );
      season_token := 'request-season-' || encode(extensions.digest(
        request_id || '|' || coalesce(resulting_version, 0)::text,
        'sha256'
      ), 'hex');
      begin
        season_result := private.refresh_eligible_season_sales_itemcode_v1(
          linked_itemcode,
          left('request-complete:' || request_id || ':' || coalesce(resulting_version, 0)::text, 180),
          season_token
        );
      exception when others then
        season_result := jsonb_build_object(
          'ok', true,
          'status', 'maintenance_deferred',
          'code', 'MAINTENANCE_DEFERRED'
        );
      end;
      save_result := coalesce(save_result, '{}'::jsonb)
        || jsonb_build_object('season_sales_office', season_result);
    end if;
  end if;

  return save_result;
end
$function$
;

create or replace function public.request_work_command_v1(p_actor_id uuid, p_session_id uuid, p_operation text, p_request_id text default null, p_expected_version bigint default null, p_patch jsonb default '{}'::jsonb, p_complete boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb; clean jsonb; request_row public.ph_active_request%rowtype; master_row public.ph_master_inventory%rowtype; qty numeric; pct numeric;
begin
 if not private.is_service_role_request() or not suspend_tag_private.session_active(p_actor_id,p_session_id) then raise exception 'REQUEST_WORK_SESSION_REQUIRED' using errcode='42501'; end if;
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated','session_id',p_session_id)::text,true);
 if p_operation='capabilities' then return public.get_request_capabilities(); end if;
 if p_operation<>'save' or jsonb_typeof(p_patch)<>'object' then raise exception 'REQUEST_WORK_OPERATION_INVALID' using errcode='22023'; end if;
 if not private.can_save_request_work() then raise exception 'REQUEST_SAVE_FORBIDDEN' using errcode='42501'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('req_match','req_spec','req_caliper','req_pic_note','req_sales_note','req_comments','av_note','req_reserve','req_photo_link','req_photo_name','req_photo_mode','req_rep_action','request_note','loc_match_qty','drive_photo_link','drive_photo_name','req_status','date_completed','req_archived','requested_by','request_folder','req_customer')) then raise exception 'REQUEST_WORK_FIELD_FORBIDDEN' using errcode='22023'; end if;
 select * into request_row from public.ph_active_request where unique_id=p_request_id;
 if not found then raise exception 'REQUEST_NOT_FOUND' using errcode='P0002'; end if;
 if not private.can_work_request_identity(request_row.request_created_by_username,request_row.request_selected_rep_username,request_row.requested_by) then raise exception 'REQUEST_ROW_FORBIDDEN' using errcode='42501'; end if;
 -- Match the import trigger lock order: master first, then its operational request.
 select * into master_row from public.ph_master_inventory where unique_id=request_row.master_id for update;
 if master_row.unique_id is null then
   select * into master_row from public.ph_master_inventory m where m.itemcode=request_row.itemcode and m.locationcode=request_row.locationcode and m.lotcode=request_row.lotcode
     and (select count(*) from public.ph_master_inventory x where x.itemcode=request_row.itemcode and x.locationcode=request_row.locationcode and x.lotcode=request_row.lotcode)=1 for update;
   if master_row.unique_id is not null then
     update public.ph_active_request set master_id=master_row.unique_id where unique_id=p_request_id;
     request_row.master_id:=master_row.unique_id;
   end if;
 end if;
 select * into request_row from public.ph_active_request where unique_id=p_request_id for update;
 if not found then raise exception 'REQUEST_NOT_FOUND' using errcode='P0002'; end if;
 if not private.can_work_request_identity(request_row.request_created_by_username,request_row.request_selected_rep_username,request_row.requested_by) then raise exception 'REQUEST_ROW_FORBIDDEN' using errcode='42501'; end if;
 clean:=p_patch - 'req_status' - 'date_completed' - 'req_archived' - 'loc_match_qty' - 'drive_photo_link' - 'drive_photo_name' - 'requested_by' - 'request_folder' - 'req_customer';
 if p_complete then
   clean:=jsonb_strip_nulls(jsonb_build_object('req_spec',request_row.req_spec,'req_match',request_row.req_match,'req_caliper',request_row.req_caliper,'req_pic_note',request_row.req_pic_note,'av_note',request_row.av_note,'req_photo_link',request_row.req_photo_link,'req_photo_name',request_row.req_photo_name))||clean;
 end if;
 if clean ? 'req_spec' then clean:=jsonb_set(clean,'{req_spec}',to_jsonb(replace(replace(coalesce(clean->>'req_spec',''),chr(92)||chr(39),chr(39)),chr(92)||chr(34),chr(34)))); end if;
 if clean ? 'av_note' then clean:=jsonb_set(clean,'{av_note}',to_jsonb(replace(replace(coalesce(clean->>'av_note',''),chr(92)||chr(39),chr(39)),chr(92)||chr(34),chr(34)))); end if;
 if p_complete and coalesce(nullif(btrim(clean->>'av_note'),''),nullif(btrim(request_row.av_note),'')) is null and nullif(btrim(coalesce(clean->>'req_spec',request_row.req_spec)), '') is not null then clean:=clean||jsonb_build_object('av_note','SPEC - '||coalesce(clean->>'req_spec',request_row.req_spec)); end if;
 if clean ? 'req_photo_link' then clean:=clean||jsonb_build_object('drive_photo_link',clean->>'req_photo_link'); end if;
 if clean ? 'req_photo_name' then clean:=clean||jsonb_build_object('drive_photo_name',clean->>'req_photo_name'); end if;
 if clean ? 'req_match' and coalesce(clean->>'req_match','') ~ '^[0-9]+([.][0-9]+)?$' then
 pct:=(clean->>'req_match')::numeric;
 if pct>100 then raise exception 'REQUEST_MATCH_INVALID' using errcode='22023'; end if;
 if coalesce(master_row.ptronhand,'') ~ '^[0-9]+([.][0-9]+)?$' then qty:=master_row.ptronhand::numeric;
 elsif coalesce(request_row.ptravailable,'') ~ '^[0-9]+([.][0-9]+)?$' then qty:=request_row.ptravailable::numeric; end if;
 if qty is not null then clean:=clean||jsonb_build_object('loc_match_qty',round(qty*pct/100)::text); end if;
 end if;
 result:=public.save_request_work(p_request_id,p_expected_version,clean,p_complete);
 select * into master_row from public.ph_master_inventory where unique_id=request_row.master_id;
 return result||jsonb_build_object('master_row',case when master_row.unique_id is null then null else to_jsonb(master_row) end);
end $fn$;
revoke all on function public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean) to service_role;

create table if not exists public.app_manual_sync_status (id boolean primary key default true check(id), status jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
alter table public.app_manual_sync_status enable row level security;
revoke all on public.app_manual_sync_status from public,anon,authenticated;
grant select,insert,update on public.app_manual_sync_status to service_role;
-- New runs use 2,000-row batches; unfinished runs keep their original count and row identity.
CREATE OR REPLACE FUNCTION public.begin_master_snapshot_stage_v1(p_run_id uuid, p_request_id uuid, p_source_manifest jsonb, p_source_digest text, p_expected_rows integer, p_expected_chunks integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '120s'
 SET lock_timeout TO '15s'
AS $function$
declare
  stage_row app_sync_private.ph_master_snapshot_stage_v1%rowtype;
  manifest_digest text;
  payload_hash text;
  missing_indexes jsonb;
  next_index integer;
  receipt jsonb;
  did_rebind boolean := false;
begin
  perform app_sync_private.assert_master_snapshot_stage_fence_v1(p_run_id);
  perform app_sync_private.master_snapshot_stage_columns_v1();
  perform set_config('statement_timeout','120s',true);
  perform set_config('lock_timeout','15s',true);
  if p_request_id is null or p_source_digest is null or p_source_digest !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_source_manifest) is distinct from 'array'
     or jsonb_array_length(p_source_manifest) < 1 or jsonb_array_length(p_source_manifest) > 100
     or p_expected_rows is null or p_expected_rows not between 1 and 50000
     or p_expected_chunks is null
     or p_expected_chunks not in (((p_expected_rows + 499) / 500), ((p_expected_rows + 1999) / 2000))
     or exists (
       select 1 from jsonb_array_elements(p_source_manifest) m(value)
       where jsonb_typeof(m.value) is distinct from 'object'
         or nullif(btrim(m.value->>'fileId'), '') is null
         or nullif(btrim(m.value->>'modifiedAt'), '') is null
         or (m.value ? 'size' and jsonb_typeof(m.value->'size') not in ('number','null'))
     ) then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_INPUT_INVALID';
  end if;
  if exists(select 1 from jsonb_array_elements(p_source_manifest) m(value)
    group by m.value->>'fileId' having count(*) > 1) then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_MANIFEST_DUPLICATE';
  end if;
  manifest_digest := encode(extensions.digest(convert_to(p_source_manifest::text, 'UTF8'), 'sha256'), 'hex');
  payload_hash := encode(extensions.digest(convert_to(
    p_source_digest || ':' || manifest_digest || ':' || p_expected_rows::text || ':' || p_expected_chunks::text,
    'UTF8'), 'sha256'), 'hex');

  insert into app_sync_private.ph_master_snapshot_stage_v1(
    request_id, run_id, source_manifest, source_manifest_digest, source_digest,
    expected_rows, expected_chunks, payload_hash
  ) values (
    p_request_id, p_run_id, p_source_manifest, manifest_digest, p_source_digest,
    p_expected_rows, p_expected_chunks, payload_hash
  ) on conflict (request_id) do nothing;

  select * into stage_row from app_sync_private.ph_master_snapshot_stage_v1 s
  where s.request_id = p_request_id for update;
  if not found then
    raise exception using errcode = '40001', message = 'MASTER_SNAPSHOT_STAGE_CONCURRENT_CHANGE';
  end if;
  if stage_row.source_manifest is distinct from p_source_manifest
     or stage_row.source_manifest_digest is distinct from manifest_digest
     or stage_row.source_digest is distinct from p_source_digest
     or stage_row.expected_rows is distinct from p_expected_rows
     or stage_row.expected_chunks is distinct from p_expected_chunks
     or stage_row.payload_hash is distinct from payload_hash then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_REQUEST_REUSED';
  end if;

  if stage_row.status = 'staging' and stage_row.run_id is distinct from p_run_id then
    -- The fence helper proves the new run owns the only canonical lease. That
    -- row lock cannot be acquired until an old in-flight publisher releases it.
    if exists(select 1 from app_sync_private.import_runs r
      where r.id=stage_row.run_id and r.state='active' and r.expires_at>clock_timestamp()) then
      raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_REBIND_BLOCKED';
    end if;
    if exists(select 1 from app_sync_private.import_leases l
      where l.key = 'ph_master_inventory' and l.run_id = stage_row.run_id) then
      raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_REBIND_BLOCKED';
    end if;
    update app_sync_private.ph_master_snapshot_stage_v1
    set run_id = p_run_id, updated_at = clock_timestamp()
    where request_id = p_request_id returning * into stage_row;
    did_rebind := true;
  end if;

  if not exists (select 1 from app_sync_private.ph_master_bulk_import_receipts_v1 r where r.request_id = p_request_id)
     and stage_row.status = 'published' then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_RECEIPT_MISSING';
  end if;
  select r.response into receipt from app_sync_private.ph_master_bulk_import_receipts_v1 r
  where r.request_id = p_request_id
    and r.run_id = stage_row.publication_run_id
    and r.source_digest = stage_row.source_digest;
  if stage_row.status = 'published' and receipt is null then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_RECEIPT_MISSING';
  end if;
  if stage_row.status = 'staging' and receipt is not null then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_RECEIPT_CONFLICT';
  end if;

  select coalesce(jsonb_agg(n.i order by n.i), '[]'::jsonb), min(n.i)
  into missing_indexes, next_index
  from generate_series(0, p_expected_chunks - 1) n(i)
  where not exists(select 1 from app_sync_private.ph_master_snapshot_stage_chunks_v1 c
    where c.request_id = p_request_id and c.chunk_index = n.i);

  return jsonb_build_object(
    'status', stage_row.status, 'requestId', p_request_id, 'runId', p_run_id,
    'sourceDigest', stage_row.source_digest,
    'sourceManifestDigest', stage_row.source_manifest_digest,
    'sourceCount', jsonb_array_length(stage_row.source_manifest), 'chunkSize', (case when stage_row.expected_chunks=((stage_row.expected_rows+1999)/2000) then 2000 else 500 end),
    'expectedRows', stage_row.expected_rows, 'expectedChunks', stage_row.expected_chunks,
    'chunksReceived', (select count(*) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id),
    'rowsReceived', (select coalesce(sum(c.row_count),0) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id),
    'missingChunkIndexes', missing_indexes, 'nextChunkIndex', next_index,
    'rebound', did_rebind,
    'replayed', stage_row.status = 'published',
    'publicationRunId', stage_row.publication_run_id,
    'publishedResponse', receipt
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.append_master_snapshot_stage_chunk_v1(p_run_id uuid, p_request_id uuid, p_chunk_index integer, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '120s'
 SET lock_timeout TO '15s'
AS $function$
declare
  stage_row app_sync_private.ph_master_snapshot_stage_v1%rowtype;
  prior_chunk app_sync_private.ph_master_snapshot_stage_chunks_v1%rowtype;
  allowed_item6 constant text[] := array[
    'locationnote','locationptn1','desigitem','desigcust','desigloc',
    'pullerresponsibility','oversellpercentage','salesnote','suspend'
  ];
  chunk_size integer;
  chunk_digest text;
  rows_written integer;
  typed_columns text;
  typed_values text;
  missing_indexes jsonb;
  next_index integer;
begin
  perform app_sync_private.assert_master_snapshot_stage_fence_v1(p_run_id);
  typed_columns := app_sync_private.master_snapshot_stage_columns_v1();
  typed_values := app_sync_private.master_snapshot_stage_columns_v1('typed');
  perform set_config('statement_timeout','120s',true);
  perform set_config('lock_timeout','15s',true);
  if p_request_id is null or p_chunk_index is null or p_chunk_index < 0
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 2000
     or octet_length(p_rows::text) > 16777216 then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_CHUNK_INVALID';
  end if;
  select * into stage_row from app_sync_private.ph_master_snapshot_stage_v1 s
  where s.request_id = p_request_id for update;
  if not found or stage_row.status <> 'staging' or stage_row.run_id is distinct from p_run_id then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_NOT_ACTIVE';
  end if;
  if p_chunk_index >= stage_row.expected_chunks then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_CHUNK_INDEX_INVALID';
  end if;
  chunk_size := case when p_chunk_index = stage_row.expected_chunks - 1
    then stage_row.expected_rows - p_chunk_index * (case when stage_row.expected_chunks=((stage_row.expected_rows+1999)/2000) then 2000 else 500 end) else (case when stage_row.expected_chunks=((stage_row.expected_rows+1999)/2000) then 2000 else 500 end) end;
  if jsonb_array_length(p_rows) <> chunk_size then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_CHUNK_SIZE_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e(value)
    where jsonb_typeof(e.value) is distinct from 'object'
       or jsonb_typeof(e.value->'values') is distinct from 'object'
       or jsonb_typeof(e.value->'rawFields') is distinct from 'array'
       or (e.value - 'values' - 'rawFields') <> '{}'::jsonb
       or nullif(btrim(e.value->'values'->>'unique_id'), '') is null
       or exists(select 1 from jsonb_array_elements(e.value->'rawFields') f(value)
         where jsonb_typeof(f.value) is distinct from 'string')
  ) then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_ROW_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e(value)
    where cardinality(array(
        select distinct jsonb_array_elements_text(e.value->'rawFields') order by 1
      )) <> jsonb_array_length(e.value->'rawFields')
       or exists(select 1 from jsonb_array_elements_text(e.value->'rawFields') f(field_name)
         where not (f.field_name = any(allowed_item6))
            or not ((e.value->'values') ? f.field_name))
       or exists(select 1 from unnest(allowed_item6) f(field_name)
         where (e.value->'values') ? f.field_name
           and not ((e.value->'rawFields') ? f.field_name))
  ) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_ITEM6_MASK_INVALID';
  end if;
  if exists (
    select 1
    from (
      select distinct k.key
      from jsonb_array_elements(p_rows) e(value)
      cross join lateral jsonb_object_keys(e.value->'values') k(key)
    ) incoming_columns
    -- This source-only report column has no live target column. Keep its
    -- exact raw value for audit/digests, never in the typed update key set.
    where incoming_columns.key<>'ext_equiv_unit' and not exists (
      select 1 from pg_attribute a
      where a.attrelid = 'app_sync_private.ph_master_snapshot_stage_rows_v1'::regclass
        and a.attname = incoming_columns.key and a.attnum > 8 and not a.attisdropped and a.attname<>'stable_identity_key'
    )
  ) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_COLUMN_INVALID';
  end if;
  chunk_digest := encode(extensions.digest(convert_to(p_rows::text, 'UTF8'), 'sha256'), 'hex');
  select * into prior_chunk from app_sync_private.ph_master_snapshot_stage_chunks_v1 c
  where c.request_id=p_request_id and c.chunk_index=p_chunk_index;
  if found then
    if prior_chunk.chunk_digest is distinct from chunk_digest or prior_chunk.row_count <> chunk_size then
      raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_CHUNK_REUSED';
    end if;
    rows_written := 0;
  else
    insert into app_sync_private.ph_master_snapshot_stage_chunks_v1(request_id,chunk_index,chunk_digest,row_count)
    values(p_request_id,p_chunk_index,chunk_digest,chunk_size);
    execute format($stage_insert$
      insert into app_sync_private.ph_master_snapshot_stage_rows_v1(
        request_id,row_number,raw_values,raw_item6_count,raw_item6_fields,field_keys,
        lineage_key,source_hash,%s
      )
      select $1, (($2 * $4) + e.ordinality)::integer,
        e.value->'values', jsonb_array_length(e.value->'rawFields'),
        array(select distinct jsonb_array_elements_text(e.value->'rawFields') order by 1),
        array(select k.key from jsonb_object_keys(e.value->'values') k(key)
          where k.key<>'ext_equiv_unit' order by k.key),
        private.ph_master_inventory_lineage_key_v1(e.value->'values'),
        private.ph_master_bulk_source_hash_v1(e.value->'values',
          array(select distinct jsonb_array_elements_text(e.value->'rawFields') order by 1)),
        %s
      from jsonb_array_elements($3) with ordinality e(value,ordinality)
      cross join lateral jsonb_populate_record(
        null::app_sync_private.ph_master_snapshot_stage_rows_v1,e.value->'values') typed
    $stage_insert$,typed_columns,typed_values) using p_request_id,p_chunk_index,p_rows,(case when stage_row.expected_chunks=((stage_row.expected_rows+1999)/2000) then 2000 else 500 end);
    get diagnostics rows_written = row_count;
  end if;
  select coalesce(jsonb_agg(n.i order by n.i), '[]'::jsonb), min(n.i)
  into missing_indexes,next_index
  from generate_series(0,stage_row.expected_chunks-1) n(i)
  where not exists(select 1 from app_sync_private.ph_master_snapshot_stage_chunks_v1 c
    where c.request_id=p_request_id and c.chunk_index=n.i);
  return jsonb_build_object(
    'status','staging','requestId',p_request_id,'runId',p_run_id,
    'chunkIndex',p_chunk_index,'rowCount',chunk_size,'accepted',true,'replayed',rows_written=0,
    'chunksReceived',(select count(*) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id),
    'rowsReceived',(select coalesce(sum(c.row_count),0) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id),
    'missingChunkIndexes',missing_indexes,'nextChunkIndex',next_index
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.stage_import_history_rows_v1(p_snapshot_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '55s'
AS $function$
declare
  v_file import_private.import_history_files%rowtype;
  v_item jsonb;
  v_number integer;
  v_number_numeric numeric;
  v_accepted integer:=0;
  v_previous integer;
  v_start integer;
  v_last integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode='42501',message='IMPORT_HISTORY_IMPORTER_FORBIDDEN';
  end if;
  if p_snapshot_id is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode='22023',message='IMPORT_HISTORY_STAGE_INVALID';
  end if;
  if jsonb_array_length(p_rows)>2000 then
    raise exception using errcode='22023',message='IMPORT_HISTORY_STAGE_INVALID';
  end if;
  select * into v_file from import_private.import_history_files f
  where f.id=p_snapshot_id for update;
  if not found then raise exception using errcode='P0002',message='IMPORT_HISTORY_SNAPSHOT_NOT_FOUND'; end if;
  if v_file.status='ready' then
    if jsonb_array_length(p_rows)=0 then
      return jsonb_build_object('snapshotId',p_snapshot_id,'acceptedRows',0,'stagedRows',v_file.staged_rows);
    end if;
    raise exception using errcode='55000',message='IMPORT_HISTORY_ALREADY_PUBLISHED';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_rows) with ordinality e(value,ordinality) order by e.ordinality loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if (select count(*) from jsonb_object_keys(v_item))<>2
      or not (v_item ? 'row_number') or not (v_item ? 'values')
    then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if jsonb_typeof(v_item->'row_number') is distinct from 'number'
      or (v_item->>'row_number') !~ '^[0-9]{1,10}$' then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if jsonb_typeof(v_item->'values') is distinct from 'array' then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if jsonb_array_length(v_item->'values')<>cardinality(v_file.columns) then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    v_number_numeric:=(v_item->>'row_number')::numeric;
    if v_number_numeric<1 or v_number_numeric>v_file.expected_rows then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_OUT_OF_RANGE';
    end if;
    v_number:=v_number_numeric::integer;
    if v_previous is null then
      v_start:=v_number;
      if v_start>v_file.staged_rows+1 then
        raise exception using errcode='22023',message='IMPORT_HISTORY_STAGE_GAP';
      end if;
    elsif v_number<>v_previous+1 then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROWS_NOT_CONTIGUOUS';
    end if;
    v_previous:=v_number;
    v_last:=v_number;
  end loop;
  if jsonb_array_length(p_rows)>0 and exists (
    select 1
    from jsonb_array_elements(p_rows) e(value)
    join import_private.import_history_rows r
      on r.snapshot_id=p_snapshot_id and r.row_number=(e.value->>'row_number')::integer
    where r.row_values is distinct from e.value->'values'
  ) then
    raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_RETRY_CONFLICT';
  end if;
  insert into import_private.import_history_rows(snapshot_id,row_number,row_values)
  select p_snapshot_id,(e.value->>'row_number')::integer,e.value->'values'
  from jsonb_array_elements(p_rows) e(value)
  on conflict do nothing;
  get diagnostics v_accepted=row_count;
  update import_private.import_history_files f
  set staged_rows=greatest(f.staged_rows,coalesce(v_last,f.staged_rows))
  where f.id=p_snapshot_id and f.status='staging' returning f.staged_rows into v_file.staged_rows;
  return jsonb_build_object('snapshotId',p_snapshot_id,'acceptedRows',v_accepted,'stagedRows',v_file.staged_rows);
end;
$function$
;
notify pgrst,'reload schema';
commit;
