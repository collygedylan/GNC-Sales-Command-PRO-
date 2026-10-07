begin;

CREATE OR REPLACE FUNCTION public.hl_order_inventory_availability(p_itemcodes text[]) RETURNS TABLE(itemcode text, contsize text, season_lot text, computed_balance numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_codes text[];
BEGIN
  SELECT coalesce(array_agg(code ORDER BY code), ARRAY[]::text[])
  INTO v_codes
  FROM (
    SELECT DISTINCT upper(btrim(raw_code)) AS code
    FROM unnest(coalesce(p_itemcodes, ARRAY[]::text[])) AS request(raw_code)
    WHERE nullif(btrim(raw_code), '') IS NOT NULL
  ) AS requested;

  IF cardinality(v_codes) = 0 OR cardinality(v_codes) > 500 THEN
    RAISE EXCEPTION USING
      errcode = '22023',
      message = 'HL_AVAILABILITY_ITEMCODES_MUST_CONTAIN_1_TO_500_VALUES';
  END IF;

  RETURN QUERY
  WITH inventory_rows AS MATERIALIZED (
    SELECT
      upper(btrim(m.itemcode)) AS itemcode,
      upper(btrim(m.contsize)) AS contsize,
      upper(btrim(m.lotcode)) AS season_lot,
      CASE
        WHEN nullif(btrim(coalesce(m.ptravailable::text, '')), '')
               ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN m.ptravailable::numeric
        ELSE 0::numeric
      END AS available
    FROM public.ph_master_inventory AS m
    WHERE upper(btrim(m.itemcode)) = ANY(v_codes)
      AND upper(btrim(m.lotcode)) IN ('27.F1', '27.S1')
      AND lower(btrim(coalesce(m.app_tab_assignment, '')))
          NOT IN (
            'not_on_inventory_dylan',
            'not_on_inventory_jd',
            'not_on_inventory_denied'
          )
  ),
  inventory AS (
    SELECT inventory_rows.itemcode, inventory_rows.contsize, inventory_rows.season_lot, sum(inventory_rows.available) AS available
    FROM inventory_rows
    GROUP BY inventory_rows.itemcode, inventory_rows.contsize, inventory_rows.season_lot
  ),
  active_po AS MATERIALIZED (
    SELECT
      upper(btrim(b.itemcode)) AS itemcode,
      upper(btrim(b.size)) AS contsize,
      upper(btrim(b.lot)) AS season_lot,
      sum(coalesce(b.remaining, 0)) AS allocations
    FROM hl_order_private.po_balances_v2() AS b
    WHERE upper(btrim(b.itemcode)) = ANY(v_codes)
      AND b.lot IN ('27.F1', '27.S1')
      AND b.status = 'ready'
    GROUP BY 1, 2, 3
  )
  SELECT
    i.itemcode,
    i.contsize,
    i.season_lot,
    greatest(0::numeric, coalesce(i.available, 0) - coalesce(p.allocations, 0))
  FROM inventory AS i
  LEFT JOIN active_po AS p
    ON p.itemcode = i.itemcode
   AND p.contsize = i.contsize
   AND p.season_lot = i.season_lot;
END;
$_$;
ALTER FUNCTION public.hl_order_inventory_availability(p_itemcodes text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.hl_order_inventory_availability(p_itemcodes text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hl_order_inventory_availability(p_itemcodes text[]) TO anon;
GRANT ALL ON FUNCTION public.hl_order_inventory_availability(p_itemcodes text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_manager_season_priority_v1(p_actor_id uuid, p_source_unique_id text, p_expected_priority integer, p_scope_fingerprint text, p_idempotency_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  actor public.profiles := private.manager_season_priority_actor_v1(p_actor_id);
  source_row public.ph_master_inventory;
  source_json jsonb;
  itemcode_value text;
  selected_lineage text;
  current_scope jsonb;
  current_scope_fingerprint text;
  v_before_state_hash text;
  after_state jsonb;
  after_state_hash text;
  overlays jsonb;
  request_fingerprint text;
  inventory_revision bigint;
  event_result jsonb;
  event_row public.ph_request_delivery_outbox;
  receipt private.manager_season_priority_receipts;
  active_receipt private.manager_season_priority_receipts;
  active_event public.ph_request_delivery_outbox;
  retried boolean := false;
  original_actor text;
  original_token text;
  bound_receipt private.manager_season_priority_receipts;
  bound_event public.ph_request_delivery_outbox;
  active_event_id uuid;
begin
  if p_expected_priority is null or p_expected_priority not between 2 and 4 then
    raise exception using errcode = '22023', message = 'SEASON_PRIORITY_EXPECTED_PRIORITY_INVALID';
  end if;
  if coalesce(p_scope_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'SEASON_PRIORITY_SCOPE_FINGERPRINT_INVALID';
  end if;
  if length(btrim(coalesce(p_idempotency_token, ''))) < 12
     or length(btrim(coalesce(p_idempotency_token, ''))) > 180 then
    raise exception using errcode = '22023', message = 'SEASON_PRIORITY_TOKEN_INVALID';
  end if;
  select r.* into bound_receipt
  from private.manager_season_priority_receipts r
  join public.ph_request_delivery_outbox o on o.event_id = r.event_id
  where o.event_key = 'reclass-inquiry:' || left(encode(extensions.digest(btrim(p_idempotency_token), 'sha256'), 'hex'), 40)
    and o.event_type = 'reclass_inquiry'
  limit 1;
  if bound_receipt.event_id is not null then
    select o.* into bound_event from public.ph_request_delivery_outbox o
    where o.event_id = bound_receipt.event_id;
    if bound_receipt.actor_id <> actor.id then
      raise exception using errcode = '42501', message = 'SEASON_PRIORITY_TOKEN_OWNERSHIP_CONFLICT';
    end if;
    if bound_receipt.source_unique_id is distinct from btrim(coalesce(p_source_unique_id, ''))
       or bound_receipt.expected_priority is distinct from p_expected_priority
       or bound_receipt.scope_fingerprint is distinct from p_scope_fingerprint then
      raise exception using errcode = '40001', message = 'SEASON_PRIORITY_TOKEN_CONFLICT';
    end if;
    return private.manager_season_priority_result_v1(bound_receipt, bound_event, true, false);
  end if;
  perform 1
  from public.app_dataset_revisions r
  where r.key in ('ph_master_inventory', 'ph_cav_import', 'ph_warehouse_assigned_items')
  order by r.key
  for share;
  if exists (
    select 1
    from unnest(array['ph_master_inventory', 'ph_cav_import', 'ph_warehouse_assigned_items']) required(key)
    left join public.app_dataset_revisions r on r.key = required.key
    where r.key is null or r.state <> 'ready'
  ) then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_REFRESH_REQUIRED';
  end if;
  select r.revision into inventory_revision
  from public.app_dataset_revisions r where r.key = 'ph_master_inventory' for share;
  if inventory_revision is null then
    raise exception using errcode = '55000', message = 'SEASON_PRIORITY_SOURCE_REVISION_MISSING';
  end if;

  select m.* into source_row
  from public.ph_master_inventory m
  where btrim(coalesce(m.unique_id, '')) = btrim(coalesce(p_source_unique_id, ''))
  limit 1 for share;
  if source_row.unique_id is null then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_MISSING';
  end if;
  source_json := to_jsonb(source_row);
  if not private.manager_season_priority_row_eligible_v1(source_json) then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_NOT_ELIGIBLE';
  end if;
  if btrim(coalesce(source_json->>'priority', '')) <> p_expected_priority::text then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_STALE';
  end if;
  itemcode_value := upper(btrim(coalesce(source_row.itemcode, '')));
  if itemcode_value = '' then
    raise exception using errcode = '22023', message = 'SEASON_PRIORITY_ITEMCODE_REQUIRED';
  end if;
  selected_lineage := private.manager_season_priority_lineage_v1(source_json);

  perform 1 from public.ph_master_inventory m
  where upper(btrim(coalesce(m.itemcode, ''))) = itemcode_value
  order by m.unique_id for share;
  current_scope := private.manager_season_priority_scope_v1(itemcode_value);
  current_scope_fingerprint := encode(extensions.digest(current_scope::text, 'sha256'), 'hex');
  if current_scope_fingerprint <> p_scope_fingerprint then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SCOPE_CHANGED';
  end if;
  if exists (
    select 1
    from public.ph_master_inventory m
    where upper(btrim(m.itemcode)) = itemcode_value
    group by private.manager_season_priority_lineage_v1(to_jsonb(m))
    having count(*) > 1
  ) then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_LINEAGE_AMBIGUOUS';
  end if;
  v_before_state_hash := private.manager_season_priority_state_hash_v1(itemcode_value);

  with scope_rows as (
    select m.unique_id, to_jsonb(m) row_json,
      private.manager_season_priority_lineage_v1(to_jsonb(m)) lineage_hash,
      case when btrim(coalesce(m.priority, '')) ~ '^[1-4]$' then btrim(m.priority)::integer end old_priority
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = itemcode_value
  ), rotated as (
    select *, case
      when unique_id = source_row.unique_id then 1
      when old_priority between 1 and p_expected_priority - 1 then old_priority + 1
      else old_priority
    end new_priority
    from scope_rows
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'unique_id', unique_id,
      'expected', jsonb_build_object(
        'itemcode', coalesce(row_json->>'itemcode', ''),
        'lotcode', coalesce(row_json->>'lotcode', ''),
        'locationcode', coalesce(row_json->>'locationcode', ''),
        'ptronhand', coalesce(row_json->>'ptronhand', ''),
        'ptravailable', coalesce(row_json->>'ptravailable', ''),
        'priority', btrim(coalesce(row_json->>'priority', '')),
        'lineageHash', lineage_hash,
        'lineage', jsonb_build_object(
          'warehouse', coalesce(row_json->>'warehouseid', row_json->>'warehousei', ''),
          'itemcode', coalesce(row_json->>'itemcode', ''),
          'contsize', coalesce(row_json->>'contsize', ''),
          'locationcode', coalesce(row_json->>'locationcode', ''),
          'lotcode', coalesce(row_json->>'lotcode', ''),
          'source', coalesce(row_json->>'source', ''),
          'desigitem', coalesce(row_json->>'desigitem', ''),
          'desigcust', coalesce(row_json->>'desigcust', ''),
          'desigloc', coalesce(row_json->>'desigloc', '')
        )
      ),
      'proposals', case when new_priority is distinct from old_priority
        then jsonb_build_array(jsonb_build_object('action', 'priority_change', 'priority', new_priority))
        else '[]'::jsonb end
    ) order by lineage_hash, unique_id), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'lineageHash', lineage_hash,
      'priority', case when new_priority is null then btrim(coalesce(row_json->>'priority', '')) else new_priority::text end
    ) order by lineage_hash,
      case when new_priority is null then btrim(coalesce(row_json->>'priority', '')) else new_priority::text end,
      unique_id), '[]'::jsonb)
  into overlays, after_state
  from rotated;

  after_state_hash := encode(extensions.digest(after_state::text, 'sha256'), 'hex');
  request_fingerprint := encode(extensions.digest(jsonb_build_object(
    'contractVersion', 'manager-season-priority-v1',
    'itemcode', itemcode_value,
    'selectedLineageHash', selected_lineage,
    'selectedPriority', p_expected_priority,
    'beforeStateHash', v_before_state_hash,
    'afterStateHash', after_state_hash
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('manager-season-priority-item:' || itemcode_value, 0));
  perform pg_advisory_xact_lock(hashtextextended('manager-season-priority:' || request_fingerprint, 0));
  select r.event_id into active_event_id
  from private.manager_season_priority_receipts r
  join public.ph_request_delivery_outbox o on o.event_id = r.event_id
  where r.itemcode_normalized = itemcode_value and r.resolution is null
  limit 1 for update of r, o;
  if active_event_id is not null then
    select r.* into active_receipt from private.manager_season_priority_receipts r where r.event_id = active_event_id;
    select o.* into active_event from public.ph_request_delivery_outbox o where o.event_id = active_event_id;
    if active_event.status in ('failed', 'unknown')
       and upper(coalesce(active_event.sanitized_error_code, '')) like 'RECLASS_CONFLICT%' then
      update private.manager_season_priority_receipts r
      set resolution = 'stale', resolved_at = now(),
          resolved_inventory_revision = inventory_revision,
          resolution_snapshot_hash = v_before_state_hash
      where r.event_id = active_receipt.event_id and r.resolution is null
      returning * into active_receipt;
      return private.manager_season_priority_result_v1(active_receipt, active_event, true, false);
    end if;
    if active_receipt.request_fingerprint <> request_fingerprint then
      raise exception using errcode = '40001', message = 'SEASON_PRIORITY_ITEM_PENDING';
    end if;
    if active_event.status in ('failed', 'unknown') then
      original_actor := active_event.payload #>> '{reclassPayload,actor,username}';
      original_token := active_event.payload #>> '{reclassPayload,idempotencyToken}';
      perform public.retry_drive_reclass_inquiry_v1(original_actor, original_token);
      select * into active_event from public.ph_request_delivery_outbox where event_id = active_receipt.event_id;
      retried := true;
    end if;
    return private.manager_season_priority_result_v1(active_receipt, active_event, true, retried);
  end if;

  event_result := public.enqueue_drive_reclass_inquiry_v1(jsonb_build_object(
    'workflowPolicyVersion', 'reclass-action-workflow-v3-row-actions-20260826',
    'idempotencyToken', btrim(p_idempotency_token),
    'actorUsername', lower(btrim(actor.username)),
    'source', jsonb_build_object(
      'unique_id', source_row.unique_id,
      'itemcode', source_row.itemcode,
      'lotcode', source_json->>'lotcode',
      'locationcode', source_json->>'locationcode'
    ),
    'transaction', jsonb_build_object(
      'requestActions', jsonb_build_array('priority_change'),
      'holdStopProposals', '[]'::jsonb,
      'scope', jsonb_build_object(),
      'seasonPriority', jsonb_build_object(
        'contractVersion', 'manager-season-priority-v1',
        'mode', 'priority_one_rotation',
        'selectedLineageHash', selected_lineage,
        'selectedPriority', p_expected_priority,
        'scopeFingerprint', current_scope_fingerprint,
        'requestFingerprint', request_fingerprint,
        'beforeStateHash', v_before_state_hash,
        'afterStateHash', after_state_hash
      )
    ),
    'rowOverlays', overlays,
    'clientVersion', 'manager-season-priority-v1'
  ));

  select o.* into event_row
  from public.ph_request_delivery_outbox o
  where o.event_id = (event_result->>'jobId')::uuid
  for update;
  if event_row.event_id is null then
    raise exception using errcode = '55000', message = 'SEASON_PRIORITY_OUTBOX_MISSING';
  end if;
  if event_row.payload #>> '{reclassPayload,transaction,seasonPriority,requestFingerprint}' is distinct from request_fingerprint then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_TOKEN_CONFLICT';
  end if;

  insert into private.manager_season_priority_receipts(
    event_id, request_fingerprint, itemcode_normalized, actor_id, source_unique_id,
    selected_lineage_hash, expected_priority, scope_fingerprint, before_state_hash,
    expected_after_hash, created_inventory_revision, last_checked_inventory_revision
  ) values (
    event_row.event_id, request_fingerprint, itemcode_value, actor.id, source_row.unique_id,
    selected_lineage, p_expected_priority, current_scope_fingerprint, v_before_state_hash,
    after_state_hash, inventory_revision, inventory_revision
  ) returning * into receipt;

  return private.manager_season_priority_result_v1(receipt, event_row, false, false);
end
$_$;
ALTER FUNCTION public.submit_manager_season_priority_v1(p_actor_id uuid, p_source_unique_id text, p_expected_priority integer, p_scope_fingerprint text, p_idempotency_token text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_manager_season_priority_v1(p_actor_id uuid, p_source_unique_id text, p_expected_priority integer, p_scope_fingerprint text, p_idempotency_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_manager_season_priority_v1(p_actor_id uuid, p_source_unique_id text, p_expected_priority integer, p_scope_fingerprint text, p_idempotency_token text) TO service_role;

create or replace function public.aura_query_bunch_v1(
  p_actor_id uuid,p_operation text,p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,bunch_note_private,private set statement_timeout='5s'
as $$
declare
  actor public.profiles; op text:=lower(btrim(coalesce(p_operation,''))); f jsonb:=coalesce(p_filters,'{}'::jsonb);
  lim integer:=greatest(1,least(100,coalesce(p_limit,50))); off integer:=0;
  record_id uuid; status_filter text; location_filter text; location_mode text; product_needle text;
  date_from timestamptz; date_to timestamptz; rows_value jsonb; total_value bigint; more_value boolean; next_cursor jsonb;
begin
  if p_actor_id is null or not exists(select 1 from public.profiles p where p.id=p_actor_id and p.username='dylan_collyge'
    and p.disabled_at is null and p.must_change_password=false and (p.locked_until is null or p.locked_until<=clock_timestamp()))
    or not private.app_account_active_at_v1(p_actor_id,'dylan_collyge',clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  if public.navigation_module_allowed_v1(p_actor_id,'bunch-note') is distinct from true then
    raise exception using errcode='42501',message='AURA_MODULE_FORBIDDEN'; end if;
  actor:=bunch_note_private.actor(p_actor_id);
  if actor.username is distinct from 'dylan_collyge' then raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  if op not in ('list','get') or jsonb_typeof(f)<>'object'
    or exists(select 1 from jsonb_object_keys(f) k where k not in ('recordId','status','locationCode','locationMode','productText','dateFrom','dateTo')) then
    raise exception using errcode='22023',message='AURA_BUNCH_FILTER_INVALID'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or p_cursor-'offset'<>'{}'::jsonb or coalesce(p_cursor->>'offset','') !~ '^[0-9]{1,9}$' then
      raise exception using errcode='22023',message='AURA_BUNCH_CURSOR_INVALID'; end if;
    off:=least(1000000,(p_cursor->>'offset')::integer);
  end if;
  record_id:=nullif(btrim(f->>'recordId'),'')::uuid;
  status_filter:=nullif(lower(btrim(f->>'status')),'');
  location_filter:=nullif(upper(btrim(f->>'locationCode')),'');
  location_mode:=lower(coalesce(f->>'locationMode','exact'));
  product_needle:=nullif(btrim(f->>'productText'),'');
  if nullif(btrim(f->>'dateFrom'),'') is not null or nullif(btrim(f->>'dateTo'),'') is not null then
    raise exception using errcode='22023',message='AURA_BUNCH_CREATION_DATE_UNAVAILABLE';
  end if;
  date_from:=nullif(btrim(f->>'dateFrom'),'')::timestamptz;
  date_to:=nullif(btrim(f->>'dateTo'),'')::timestamptz;
  if (op='get' and record_id is null) or location_mode not in ('exact','prefix')
    or (status_filter is not null and status_filter not in ('open','complete','cancelled'))
    or length(coalesce(location_filter,''))>80 or length(coalesce(product_needle,''))>160
    or length(coalesce(f->>'dateFrom',''))>48 or length(coalesce(f->>'dateTo',''))>48
    or (date_from is not null and date_to is not null and date_from>date_to) then
    raise exception using errcode='22023',message='AURA_BUNCH_FILTER_INVALID'; end if;
  with matched as materialized (
    select j.id,j.updated_at,bunch_note_private.job_json(j) detail from bunch_note_private.jobs j
    where bunch_note_private.can_read(actor,j)
      and (record_id is null or j.id=record_id)
      and (status_filter is null or lower(j.status)=status_filter)
      and (location_filter is null or case location_mode when 'prefix' then upper(btrim(j.location)) like location_filter||'%' else upper(btrim(j.location))=location_filter end)
      and (product_needle is null or position(lower(product_needle) in lower(j.block))>0
        or position(lower(product_needle) in lower(j.location))>0
        or exists(select 1 from jsonb_array_elements(coalesce((bunch_note_private.job_json(j)->'body'->'source'),'[]'::jsonb)) s
          where position(lower(product_needle) in lower(concat_ws(' ',s->>'itemcode',s->>'commonname',s->>'lotcode')))>0))
  ), numbered as (
    select m.*,row_number() over(order by m.updated_at desc,m.id desc) rn from matched m
  )
  select (select count(*) from matched),coalesce(jsonb_agg(detail||jsonb_build_object('recordId',id) order by rn)
    filter(where rn>off and rn<=off+lim),'[]'::jsonb)
    into total_value,rows_value from numbered;
  more_value:=total_value>off+lim;
  if more_value then next_cursor:=jsonb_build_object('offset',off+lim); end if;
  return jsonb_build_object('ok',true,'complete',true,'rows',rows_value,'total',total_value,
    'hasMore',more_value,'nextCursor',next_cursor);
end $$;
REVOKE ALL ON FUNCTION public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer) TO service_role;

create or replace function bunch_note_private.card_command(p_actor uuid,p_operation text,p_payload jsonb default '{}'::jsonb,
 p_command_id uuid default null,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; author boolean; job bunch_note_private.jobs; prior bunch_note_private.commands;
 card bunch_note_private.bunch_note_work_cards; note_id uuid; request jsonb; result jsonb; action jsonb; source_row jsonb;
  v_card_id uuid; v_action_id text; option_value bunch_note_private.options; state text; reason text; flags jsonb; owner uuid; command_job uuid;
begin
 actor:=bunch_note_private.actor(p_actor); author:=actor.username='dylan_collyge';
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000000 then raise exception 'BUNCH_NOTE_PAYLOAD_INVALID'; end if;
 if p_operation='list' then
   return jsonb_build_object('jobs',(select coalesce(jsonb_agg((case when coalesce((j.body->>'format_version')::integer,0)>=5
     then bunch_note_private.card_safe_job(j,actor.id) else bunch_note_private.job_json(j) end)||jsonb_build_object('delivery_status',
      coalesce((select p.delivery_status from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id
       where v.job_id=j.id order by v.instruction_revision desc limit 1),'not_sent')) order by j.updated_at desc),'[]')
   from bunch_note_private.jobs j where (coalesce((j.body->>'format_version')::integer,0)>=5 and exists(
    select 1 from bunch_note_private.bunch_notes n join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=n.id
    where n.job_id=j.id and (author or (wc.active and (wc.owner_id=actor.id or (wc.owner_id is null and wc.status='open' and j.status='open'))))))
    or (coalesce((j.body->>'format_version')::integer,0)<5 and bunch_note_private.can_read(actor,j))));
 elsif p_operation in ('get','pdf') then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
  if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if coalesce((job.body->>'format_version')::integer,0)>=5 then
   if p_operation='pdf' then
    if not author then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
    if not exists(select 1 from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id
     where v.job_id=job.id and v.instruction_revision=coalesce((p_payload->>'instruction_revision')::integer,job.instruction_revision)) then raise exception 'BUNCH_NOTE_NOT_FOUND'; end if;
    return bunch_note_private.bunch_note_command_legacy(p_actor,'pdf',p_payload,null,null);
   end if;
   result:=bunch_note_private.card_safe_job(job,actor.id);
   if author then return jsonb_build_object('job',result-'audit'-'versions'-'work_reports','versions',result->'versions','work_reports',result->'work_reports','audit',result->'audit'); end if;
   return jsonb_build_object('job',result);
  end if;
  return bunch_note_private.bunch_note_command_legacy(p_actor,p_operation,p_payload,null,null);
 elsif p_operation in ('destinations','destination_detail') then
  return bunch_note_private.card_destination_view(actor,case when p_operation='destination_detail' then p_payload->>'location' else null end);
 elsif p_operation='work_pdf' then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
  if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if coalesce((job.body->>'format_version')::integer,0)>=5 and not author then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
  return bunch_note_private.bunch_note_command_legacy(p_actor,p_operation,p_payload,p_command_id,p_expected_revision);
 elsif p_operation='destination_lookup' then
  if not author and nullif(p_payload->>'job_id','') is not null then
   v_card_id:=nullif(p_payload->>'card_id','')::uuid;
   select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
   if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
   if coalesce((job.body->>'format_version')::integer,0)>=5 then
    if v_card_id is null or not bunch_note_private.card_allowed(actor.id,job,v_card_id) then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
   elsif not bunch_note_private.can_read(actor,job) then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
   if coalesce((job.body->>'format_version')::integer,0)>=5 then
    select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=job.id;
    select * into card from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.card_id=v_card_id and wc.active;
    if exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'source_ids','[]')) sid where not(card.row_ids ? sid)) then raise exception 'BUNCH_NOTE_CARD_SOURCE_INVALID'; end if;
   end if;
  end if;
  return bunch_note_private.destination_lookup(actor,p_payload);
 end if;
 if p_operation not in ('assign_card','claim_card','release_card','complete_card','progress','actual','add_action','option_add','cancel') then
  raise exception 'BUNCH_NOTE_OPERATION_INVALID';
 end if;
 if p_command_id is null then raise exception 'BUNCH_NOTE_COMMAND_REQUIRED'; end if;
 request:=jsonb_build_object('operation',p_operation,'payload',p_payload,'revision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
 select * into prior from bunch_note_private.commands where id=p_command_id;
 if found then
  if prior.actor_id<>actor.id or prior.request<>request then raise exception 'BUNCH_NOTE_COMMAND_CONFLICT'; end if;
  if prior.response ? 'job' then
   command_job:=(prior.response->'job'->>'id')::uuid;
   select * into job from bunch_note_private.jobs where id=command_job;
   if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
   if coalesce((job.body->>'format_version')::integer,0)>=5 then result:=bunch_note_private.card_safe_job(job,actor.id);
    return jsonb_set(prior.response,'{job}',result,false); end if;
  end if;
  return prior.response;
 end if;
 if p_operation='cancel' then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid for update;
  if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if coalesce((job.body->>'format_version')::integer,0)<5 then
   return bunch_note_private.bunch_note_command_legacy(p_actor,p_operation,p_payload,p_command_id,p_expected_revision);
  end if;
  if not author or nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
  if job.revision is distinct from p_expected_revision or job.status<>'open' then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  perform set_config('bunch_note.card_command','on',true);
  update bunch_note_private.bunch_note_work_cards wc set status='retired',active=false,revision=wc.revision+1,updated_at=now()
   from bunch_note_private.bunch_notes n where n.job_id=job.id and wc.bunch_note_id=n.id and wc.active;
  update bunch_note_private.jobs set status='cancelled',revision=revision+1,updated_at=now() where id=job.id returning * into job;
  insert into bunch_note_private.audit(job_id,actor_id,operation,detail) values(job.id,actor.id,p_operation,p_payload||jsonb_build_object('job_revision',job.revision));
  result:=jsonb_build_object('job',bunch_note_private.card_safe_job(job,actor.id));
 else
  v_card_id:=nullif(p_payload->>'card_id','')::uuid;
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid for update;
  if not found or coalesce((job.body->>'format_version')::integer,0)<5 then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=job.id;
  select * into card from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.card_id=v_card_id and wc.active for update;
  if not found or v_card_id is null or job.revision is null then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if p_expected_revision is distinct from card.revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  if p_operation='assign_card' then
   if not author or job.status<>'open' or card.status<>'open' then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
   owner:=nullif(p_payload->>'owner_id','')::uuid;
   if not bunch_note_private.active_card_owner(owner) then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
   update bunch_note_private.bunch_note_work_cards set owner_id=owner,revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
  elsif p_operation='claim_card' then
   if job.status<>'open' or card.status<>'open' or card.owner_id is not null then raise exception 'BUNCH_NOTE_ALREADY_CLAIMED'; end if;
   update bunch_note_private.bunch_note_work_cards set owner_id=actor.id,revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
  elsif p_operation='release_card' then
   if job.status<>'open' or card.status<>'open' or (card.owner_id is distinct from actor.id and not author) then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
   update bunch_note_private.bunch_note_work_cards set owner_id=null,revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
  else
   if card.owner_id is distinct from actor.id and not (author and p_operation='actual' and nullif(p_payload->>'replaces_id','') is not null) then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
   if job.status<>'open' and not (author and p_operation='actual' and nullif(p_payload->>'replaces_id','') is not null) then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
   if card.status<>'open' and not (author and p_operation='actual' and nullif(p_payload->>'replaces_id','') is not null) then raise exception 'BUNCH_NOTE_CARD_COMPLETE'; end if;
   perform set_config('bunch_note.card_command','on',true);
   if p_operation='progress' then
    if card.status<>'open' then raise exception 'BUNCH_NOTE_CARD_COMPLETE'; end if;
    state:=p_payload->>'status'; reason:=nullif(btrim(p_payload->>'reason'),'');
    if state not in ('done','not_needed') or state is null then raise exception 'BUNCH_NOTE_PROGRESS_INVALID'; end if;
   select a into action from jsonb_array_elements(bunch_note_private.card_actions(job)) a where a->>'id'=p_payload->>'action_id';
    if action is null or action->>'card_id' is distinct from v_card_id::text then raise exception 'BUNCH_NOTE_ACTION_CARD_INVALID'; end if;
    if state='not_needed' and reason is null then raise exception 'BUNCH_NOTE_REASON_REQUIRED'; end if;
    flags:='[]'; if state='done' then flags:=bunch_note_private.check_done(job,action,reason); end if;
    update bunch_note_private.jobs set progress=progress||jsonb_build_object(action->>'id',jsonb_build_object('status',state,'reason',reason,
     'review_flags',flags,'actor_id',actor.id,'at',now())) where id=job.id;
   elsif p_operation='actual' then
   select a into action from jsonb_array_elements(bunch_note_private.card_actions(job)) a where a->>'id'=p_payload->>'action_id';
     if action is null or action->>'card_id' is distinct from v_card_id::text then raise exception 'BUNCH_NOTE_ACTION_CARD_INVALID'; end if;
    if not(card.row_ids ? (p_payload->>'source_id')) then raise exception 'BUNCH_NOTE_CARD_SOURCE_INVALID'; end if;
    select r into source_row from jsonb_array_elements(bunch_note_private.work_source(job)) r where r->>'unique_id'=p_payload->>'source_id';
    if source_row is null then raise exception 'BUNCH_NOTE_CARD_SOURCE_INVALID'; end if;
    v_action_id:=action->>'id';
    if exists(select 1 from bunch_note_private.worker_actions w where w.job_id=job.id and w.action->>'id'=v_action_id and nullif(w.action->>'card_id','') is null) then
     update bunch_note_private.worker_actions wa set action=wa.action||jsonb_build_object('card_id',v_card_id)
      where wa.job_id=job.id and wa.action->>'id'=v_action_id;
   end if;
    perform bunch_note_private.validate_destination(p_payload||jsonb_build_object('scope','location'),jsonb_build_array(source_row));
    perform bunch_note_private.record_actual(job,p_payload,actor.id);
   elsif p_operation='add_action' then
    if jsonb_array_length(bunch_note_private.actions(job))>=200 then raise exception 'BUNCH_NOTE_ACTION_LIMIT'; end if;
    action:=p_payload->'action';
     if action is null or action->>'card_id' is distinct from v_card_id::text then raise exception 'BUNCH_NOTE_ACTION_CARD_INVALID'; end if;
    if nullif(action->>'option_id','') is null then raise exception 'BUNCH_NOTE_OPTION_REQUIRED'; end if;
    if action->>'scope'='location' and not coalesce((action->>'freeform')::boolean,false) then
     action:=action||jsonb_build_object('scope','rows','row_ids',card.row_ids);
    end if;
    action:=(bunch_note_private.structured_note(job.body||jsonb_build_object('source',bunch_note_private.work_source(job),'actions',jsonb_build_array(action)))->'actions')->0;
    if exists(select 1 from jsonb_array_elements(bunch_note_private.actions(job)) a where a->>'id'=action->>'id')
     or exists(select 1 from bunch_note_private.actuals a where a.job_id=job.id and a.action_id=action->>'id') then raise exception 'BUNCH_NOTE_ACTION_ID_REUSED'; end if;
    if (action->>'scope')='rows' and not(card.row_ids @> (action->'row_ids')) then raise exception 'BUNCH_NOTE_ACTION_CARD_ROWS_INVALID'; end if;
    action:=bunch_note_private.validate_action(action,(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(bunch_note_private.work_source(job)) r where card.row_ids ? (r->>'unique_id')));
    perform bunch_note_private.validate_destination(action,bunch_note_private.work_source(job));
    action:=(action-'quantity'-'percentage')||jsonb_build_object('card_id',v_card_id,'worker_added',true,'actor_id',actor.id,'created_at',now(),
     'destination',upper(btrim(coalesce(action->>'destination',''))),'source_snapshot',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(bunch_note_private.work_source(job)) r where card.row_ids ? (r->>'unique_id')));
    insert into bunch_note_private.worker_actions(job_id,action,actor_id) values(job.id,action,actor.id);
   elsif p_operation='option_add' then
    insert into bunch_note_private.options(category,label,kind,created_by) values(p_payload->>'category',btrim(p_payload->>'label'),p_payload->>'kind',actor.id) returning * into option_value;
   end if;
   if p_operation='complete_card' then
    if card.owner_id is distinct from actor.id or job.status<>'open' or card.status<>'open' then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
    if exists(select 1 from jsonb_array_elements(bunch_note_private.card_actions(job)) a where a->>'card_id'=v_card_id::text and not(job.progress ? (a->>'id'))) then raise exception 'BUNCH_NOTE_UNRESOLVED_ACTIONS'; end if;
    update bunch_note_private.bunch_note_work_cards set status='complete',revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
   else
    update bunch_note_private.bunch_note_work_cards set revision=revision+1,updated_at=now(),
     status=case when p_operation='actual' and job.status='open' then 'open' else status end where bunch_note_id=note_id and card_id=v_card_id returning * into card;
   end if;
  end if;
  update bunch_note_private.jobs set revision=revision+1,updated_at=now() where id=job.id;
  if p_operation='complete_card' and not exists(select 1 from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.active and wc.status<>'complete') then
   update bunch_note_private.jobs set status='complete',revision=revision+1,updated_at=now() where id=job.id;
  end if;
  select * into job from bunch_note_private.jobs where id=job.id;
  insert into bunch_note_private.audit(job_id,actor_id,operation,detail) values(job.id,actor.id,p_operation,
   p_payload||jsonb_build_object('card_id',v_card_id,'card_revision',card.revision,'job_revision',job.revision));
  result:=jsonb_build_object('job',bunch_note_private.card_safe_job(job,actor.id));
  if p_operation='option_add' then result:=result||jsonb_build_object('option',to_jsonb(option_value)); end if;
 end if;
 insert into bunch_note_private.commands(id,actor_id,request,response) values(p_command_id,actor.id,request,result);
 return result;
end $$;
REVOKE ALL ON FUNCTION bunch_note_private.card_command(uuid,text,jsonb,uuid,bigint) FROM public,anon,authenticated,service_role;

create or replace function suspend_tag_private.command(p_actor_id uuid,p_operation text,p_payload jsonb,p_command_id uuid,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; s public.ph_soc_master; edited public.ph_soc_master; w suspend_tag_private.workflows;
  a suspend_tag_private.approvals; receipt suspend_tag_private.commands; input jsonb; result jsonb; patch jsonb;
  uid text; was_denied boolean; event_id uuid; approval_id uuid; decision text;
begin
  actor:=suspend_tag_private.actor(p_actor_id);
  if p_operation='approval' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and actor.username not in ('dylan_collyge','megan_kelly','dan_mccuistion')) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','canDecide',a.rep_id=actor.id and a.status='pending'
      and exists(select 1 from suspend_tag_private.workflows x join public.ph_soc_master r on r.unique_id=x.source_uid
        where x.current_approval_id=a.id and x.status='awaiting_rep' and r.last_updated is not distinct from a.source_revision and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','dan_mccuistion') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
  if p_operation='rows' then
    return jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]') from public.ph_soc_master r
      where r.unique_id in (select jsonb_array_elements_text(p_payload->'ids')) and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_command_id is null then raise exception 'SUSPEND_TAG_COMMAND_REQUIRED' using errcode='22023'; end if;
  input:=jsonb_build_object('operation',p_operation,'payload',p_payload,'version',p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended('suspend-tag-v2:'||actor.id||':'||p_command_id,0));
  select * into receipt from suspend_tag_private.commands where actor_id=actor.id and command_id=p_command_id;
  if found then
    if receipt.request<>input then raise exception 'SUSPEND_TAG_TOKEN_CONFLICT' using errcode='22023'; end if;
    return receipt.response;
  end if;
  uid:=p_payload->>'sourceUid';
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or a.rep_id<>actor.id then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    uid:=a.source_uid;
  end if;
  select * into s from public.ph_soc_master where unique_id=uid for update;
  if not found or not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
  insert into suspend_tag_private.workflows(source_uid,source_revision) values(uid,s.last_updated) on conflict do nothing;
  select * into w from suspend_tag_private.workflows where source_uid=uid for update;
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=a.id for update;
    decision:=p_payload->>'decision';
    if decision not in ('approve','deny') or decision is null then raise exception 'SUSPEND_TAG_DECISION_INVALID' using errcode='22023'; end if;
    if a.source_revision is distinct from s.last_updated or w.current_approval_id is distinct from a.id then raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='40001'; end if;
    if a.status<>'pending' then
      if a.status<>(case when decision='approve' then 'approved' else 'denied' end) then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='40001'; end if;
    else
      update suspend_tag_private.approvals set status=case when decision='approve' then 'approved' else 'denied' end,decided_at=now(),decided_by=actor.id where id=a.id returning * into a;
      update suspend_tag_private.workflows set status=a.status,version=version+1,updated_at=now() where source_uid=uid;
      if decision='deny' then update public.ph_soc_master set date_completed=null where unique_id=uid; end if;
      insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
        values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),now()) returning public.ph_request_delivery_outbox.event_id into event_id;
      update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;
    end if;
    result:=jsonb_build_object('ok',true,'decision',a.status,'approvalId',a.id);
  else
    if not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz then raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='40001'; end if;
    if p_expected_version is not null and w.version<>p_expected_version then raise exception 'SUSPEND_TAG_VERSION_CHANGED' using errcode='40001'; end if;
    if w.source_revision is distinct from s.last_updated then
      update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
      update suspend_tag_private.workflows set source_revision=s.last_updated,status='pending',completed_by=null,completed_at=null,current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
    end if;
    if p_operation in ('save','complete') then
      if w.status in ('awaiting_rep','approved') then raise exception 'SUSPEND_TAG_REVIEW_LOCKED' using errcode='42501'; end if;
      was_denied:=w.status='denied'; patch:=coalesce(p_payload->'patch','{}');
      if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) k where k<>all(array['dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','av_note','match','loc_match_qty','initial_ptr'])) then raise exception 'SUSPEND_TAG_FIELD_FORBIDDEN' using errcode='42501'; end if;
      edited:=jsonb_populate_record(s,patch);
      if p_operation='complete' then perform suspend_tag_private.validate_review(edited); end if;
      update public.ph_soc_master set dock_spec=edited.dock_spec,dock_caliper=edited.dock_caliper,dock_note=edited.dock_note,
        dock_photo_link=edited.dock_photo_link,dock_photo_name=edited.dock_photo_name,av_note=edited.av_note,match=edited.match,
        loc_match_qty=edited.loc_match_qty,initial_ptr=edited.initial_ptr where unique_id=uid returning * into s;
      -- Sync only the exact inventory identity; lifecycle state stays in Suspend Tag.
      update public.ph_master_inventory m set spec=coalesce(nullif(s.dock_spec,''),m.spec),caliper=coalesce(nullif(s.dock_caliper,''),m.caliper),
        av_note=coalesce(nullif(s.av_note,''),m.av_note),match=coalesce(nullif(s.match,''),m.match),
        photo_link=coalesce(nullif(s.dock_photo_link,''),m.photo_link),photo_name=coalesce(nullif(s.dock_photo_name,''),m.photo_name),
        loc_match_qty=coalesce(nullif(s.loc_match_qty,''),m.loc_match_qty),initial_ptr=coalesce(nullif(s.initial_ptr,''),m.initial_ptr)
        where m.itemcode=s.itemcode and m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'');
      if p_operation='complete' then
        update public.ph_soc_master set date_completed=clock_timestamp() where unique_id=uid returning * into s;
        update suspend_tag_private.workflows set status='completed',completed_by=actor.id,completed_at=s.date_completed,version=version+1,updated_at=now() where source_uid=uid;
        if was_denied then approval_id:=suspend_tag_private.request_approval(uid); end if;
      end if;
    elsif p_operation='send' then
      approval_id:=suspend_tag_private.request_approval(uid);
    elsif p_operation='retry' then
      if w.current_approval_id is null then raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023'; end if;
      update public.ph_request_delivery_outbox as outbox set status='pending',next_attempt_at=now(),sanitized_error_code=null
        where outbox.event_id in(select request_event_id from suspend_tag_private.approvals where id=w.current_approval_id) and outbox.status='failed';
    else raise exception 'SUSPEND_TAG_OPERATION_INVALID' using errcode='22023';
    end if;
    result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
  end if;
  insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result);
  return result;
end $$;

commit;
