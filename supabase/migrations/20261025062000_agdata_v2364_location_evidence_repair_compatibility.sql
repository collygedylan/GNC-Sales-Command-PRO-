begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.get_request_drive_evidence_health_snapshot_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  mismatch_count bigint := 0;
  checked_count bigint := 0;
  mismatch_request_ids jsonb := '[]'::jsonb;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'REQUEST_DRIVE_HEALTH_FORBIDDEN';
  end if;

  with latest_completion as (
    select distinct on (history.master_id)
      history.unique_id,
      history.master_id,
      history.req_spec,
      history.req_caliper,
      history.req_match,
      history.req_pic_note,
      history.av_note,
      history.req_photo_link,
      history.req_photo_name,
      coalesce(history.date_completed, history.updated_at) as completed_at,
      master.spec as master_spec,
      master.caliper as master_caliper,
      master.match as master_match,
      master.pic_note as master_pic_note,
      master.av_note as master_av_note,
      master.photo_link as master_photo_link,
      master.photo_name as master_photo_name,
      master.av_rule_last_cleared_at,
      master.av_rule_last_clear_reason,
      master.av_rule_bundle_updated_at,
      master.av_rule_av_note_updated_at,
      master.av_rule_spec_updated_at,
      master.av_rule_match_updated_at,
      master.av_rule_caliper_updated_at,
      master.av_rule_photo_updated_at,
      evidence.itemcode_key is not null as location_evidence_present,
      evidence.updated_at as location_evidence_updated_at,
      evidence.cleared_at as location_evidence_cleared_at,
      evidence.expires_at as location_evidence_expires_at,
      evidence.baseline_on_hand as location_evidence_baseline_on_hand,
      evidence.initial_photo_match_qty as location_evidence_initial_photo_match_qty,
      evidence.current_photo_match_qty as location_evidence_current_photo_match_qty,
      private.inventory_location_evidence_number_v2(master.ptronhand) as master_current_on_hand
    from public.ph_request_history history
    join public.ph_master_inventory master on master.unique_id = history.master_id
    left join app_sync_private.inventory_location_evidence_v1 evidence
      on evidence.itemcode_key = upper(btrim(master.itemcode))
      and evidence.locationcode_key = upper(btrim(master.locationcode))
    where history.date_completed >= now() - interval '48 hours'
      and lower(btrim(coalesce(history.req_status, ''))) in ('complete','completed','done')
    order by history.master_id, history.date_completed desc nulls last, history.updated_at desc nulls last
  ), evaluated as (
    select completion.*,
      (
        (
          nullif(btrim(completion.req_spec), '') is not null
          and coalesce(btrim(completion.req_spec), '') is distinct from coalesce(btrim(completion.master_spec), '')
          and (completion.av_rule_spec_updated_at is null or completion.av_rule_spec_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_caliper), '') is not null
          and coalesce(btrim(completion.req_caliper), '') is distinct from coalesce(btrim(completion.master_caliper), '')
          and (completion.av_rule_caliper_updated_at is null or completion.av_rule_caliper_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_match), '') is not null
          and coalesce(btrim(completion.req_match), '') is distinct from coalesce(btrim(completion.master_match), '')
          and (completion.av_rule_match_updated_at is null or completion.av_rule_match_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_pic_note), '') is not null
          and coalesce(btrim(completion.req_pic_note), '') is distinct from coalesce(btrim(completion.master_pic_note), '')
        )
        or (
          nullif(btrim(completion.av_note), '') is not null
          and coalesce(btrim(completion.av_note), '') is distinct from coalesce(btrim(completion.master_av_note), '')
          and (completion.av_rule_av_note_updated_at is null or completion.av_rule_av_note_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_photo_link), '') is not null
          and coalesce(btrim(completion.req_photo_link), '') is distinct from coalesce(btrim(completion.master_photo_link), '')
          and (completion.av_rule_photo_updated_at is null or completion.av_rule_photo_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_photo_name), '') is not null
          and coalesce(btrim(completion.req_photo_name), '') is distinct from coalesce(btrim(completion.master_photo_name), '')
          and (completion.av_rule_photo_updated_at is null or completion.av_rule_photo_updated_at <= completion.completed_at)
        )
      )
      and (
        completion.av_rule_bundle_updated_at is null
        or completion.av_rule_bundle_updated_at <= completion.completed_at
      )
      and (completion.av_rule_last_cleared_at is null
           or completion.av_rule_last_cleared_at < completion.completed_at)
      and not (
        completion.location_evidence_present
        and (
          completion.location_evidence_updated_at >= completion.completed_at
          or completion.location_evidence_cleared_at is not null
          or (completion.location_evidence_expires_at is not null
              and clock_timestamp() > completion.location_evidence_expires_at)
          or coalesce(private.inventory_location_evidence_qty_v2(
            completion.location_evidence_baseline_on_hand,
            completion.location_evidence_initial_photo_match_qty,
            completion.master_current_on_hand
          ), completion.location_evidence_current_photo_match_qty, 0) <= 0
        )
      ) as has_repairable_mismatch
    from latest_completion completion
  )
  select
    count(*),
    count(*) filter (where evaluated.has_repairable_mismatch),
    coalesce(
      jsonb_agg(to_jsonb(evaluated.unique_id) order by evaluated.completed_at, evaluated.unique_id)
        filter (where evaluated.has_repairable_mismatch and evaluated.unique_id is not null),
      '[]'::jsonb
    )
  into checked_count, mismatch_count, mismatch_request_ids
  from evaluated;

  return jsonb_build_object(
    'contract_version', 'request-drive-evidence-health-v1',
    'recent_completed_count', checked_count,
    'evidence_mismatch_count', mismatch_count,
    'mismatch_request_ids', mismatch_request_ids
  );
end
$function$;

create or replace function private.apply_inventory_location_evidence_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
  evidence_changed boolean:=false;
  source_row boolean:=false;
  current_qty numeric;
  active_evidence boolean:=false;
  guard_enabled boolean:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'')='on';
begin
  if nullif(btrim(coalesce(new.itemcode,'')),'') is null
    or nullif(btrim(coalesce(new.locationcode,'')),'') is null then return new; end if;
  if tg_op='UPDATE' and not guard_enabled then
    evidence_changed:=(new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
      is distinct from
      (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment);
    if private.ph_master_inventory_import_run_v1() is null and evidence_changed then return new; end if;
  end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.itemcode_key=upper(btrim(new.itemcode)) and e.locationcode_key=upper(btrim(new.locationcode));
  if not found then return new; end if;
  source_row:=new.unique_id=evidence.source_unique_id
    or upper(btrim(coalesce(new.lotcode,'')))=upper(btrim(coalesce(evidence.source_lotcode,'')));
  current_qty:=evidence.current_photo_match_qty;
  if source_row then
    current_qty:=coalesce(private.inventory_location_evidence_qty_v2(
      evidence.baseline_on_hand,evidence.initial_photo_match_qty,
      private.inventory_location_evidence_number_v2(new.ptronhand)
    ),current_qty);
  end if;
  active_evidence:=evidence.cleared_at is null
    and (evidence.expires_at is null or clock_timestamp()<=evidence.expires_at)
    and (evidence.initial_photo_match_qty is null or evidence.initial_photo_match_qty<=0 or coalesce(current_qty,0)>0);
  new.spec:=case when active_evidence then evidence.spec else null end;
  new.caliper:=evidence.caliper;
  new.match:=case when active_evidence then evidence.match else null end;
  new.loc_match_qty:=case when not active_evidence then null when source_row then current_qty::text
    else private.inventory_location_match_qty_v1(new.ptronhand,evidence.match,evidence.loc_match_qty) end;
  new.initial_ptr:=evidence.initial_ptr;
  new.av_note:=case when active_evidence then evidence.av_note else null end;
  new.pic_note:=case when active_evidence then evidence.pic_note else null end;
  new.sales_note:=case when active_evidence then evidence.sales_note else null end;
  new.photo_link:=case when active_evidence then evidence.photo_link else null end;
  new.photo_name:=case when active_evidence then evidence.photo_name else null end;
  new.date_completed:=case when active_evidence then evidence.date_completed else null end;
  new.app_tab_assignment:=evidence.app_tab_assignment;
  return new;
end
$function$;

create or replace function private.sync_master_inventory_canonical_v2362()
returns trigger language plpgsql security definer set search_path='' as $function$
declare evidence app_sync_private.inventory_location_evidence_v1%rowtype;
declare current_on_hand numeric;
declare canonical_baseline numeric;
declare canonical_match numeric;
declare canonical_initial numeric;
declare canonical_current numeric;
declare canonical_photo_date timestamptz;
declare canonical_expiry timestamptz;
declare canonical_photo_url text;
declare active_evidence boolean;
declare evidence_changed boolean:=false;
declare guard_enabled boolean:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'')='on';
begin
  if tg_op='UPDATE' and not guard_enabled
      and private.ph_master_inventory_import_run_v1() is null then
    evidence_changed:=(new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
      is distinct from
      (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment);
    if evidence_changed then return new; end if;
  end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.itemcode_key=upper(btrim(coalesce(new.itemcode,'')))
    and e.locationcode_key=upper(btrim(coalesce(new.locationcode,'')));
  current_on_hand:=private.request_numeric_v2362(new.ptronhand);
  canonical_baseline:=coalesce(evidence.baseline_on_hand,new.baseline_on_hand,
    private.request_numeric_v2362(new.initial_ptr),current_on_hand);
  canonical_match:=coalesce(evidence.loc_match_pct,new.loc_match_pct,
    private.request_numeric_v2362(new.match));
  canonical_initial:=coalesce(evidence.initial_photo_match_qty,new.initial_photo_match_qty,
    case when canonical_baseline is not null and canonical_match between 0 and 100
      then round(canonical_baseline*canonical_match/100.0) end);
  canonical_current:=coalesce(private.inventory_location_evidence_qty_v2(
    canonical_baseline,canonical_initial,current_on_hand),evidence.current_photo_match_qty,
    new.loc_photo_match,private.request_numeric_v2362(new.loc_match_qty));
  canonical_photo_date:=coalesce(evidence.evaluated_at,new.photo_date,new.date_completed,
    new.av_rule_photo_updated_at,new.av_rule_bundle_updated_at);
  canonical_expiry:=coalesce(evidence.expires_at,new.photo_expires_at,
    private.inventory_location_evidence_expiry_v2(canonical_photo_date));
  canonical_photo_url:=coalesce(nullif(btrim(coalesce(new.photo_url,'')),''),
    nullif(btrim(coalesce(evidence.photo_link,'')),''),nullif(btrim(coalesce(new.photo_link,'')),''));
  active_evidence:=evidence.cleared_at is null
    and coalesce(canonical_current,0)>0
    and (canonical_expiry is null or clock_timestamp()<=canonical_expiry)
    and coalesce(canonical_photo_url,nullif(btrim(coalesce(new.spec,'')),''),
      nullif(btrim(coalesce(evidence.spec,'')),''),nullif(btrim(coalesce(new.caliper,'')),''),
      nullif(btrim(coalesce(evidence.caliper,'')),''),nullif(btrim(coalesce(new.match,'')),''),
      nullif(btrim(coalesce(evidence.match,'')),''),nullif(btrim(coalesce(new.av_note,'')),''),
      nullif(btrim(coalesce(evidence.av_note,'')),''),nullif(btrim(coalesce(new.pic_note,'')),''),
      nullif(btrim(coalesce(evidence.pic_note,'')),''),nullif(btrim(coalesce(new.sales_note,'')),''),
      nullif(btrim(coalesce(evidence.sales_note,'')),'')) is not null;
  new.baseline_on_hand:=canonical_baseline;
  new.loc_match_pct:=canonical_match;
  new.initial_photo_match_qty:=canonical_initial;
  new.photo_expires_at:=canonical_expiry;
  if active_evidence then
    new.loc_photo_match:=canonical_current;
    new.photo_url:=canonical_photo_url;
    new.photo_date:=canonical_photo_date;
    new.photos:=private.request_photo_array_v2362(new.photos,canonical_photo_url,
      coalesce(evidence.photo_name,new.photo_name));
    new.pick_note:=coalesce(nullif(new.pick_note,''),nullif(evidence.pic_note,''),nullif(new.pic_note,''));
    new.spec:=coalesce(nullif(new.spec,''),nullif(evidence.spec,''));
    new.caliper:=coalesce(nullif(new.caliper,''),nullif(evidence.caliper,''));
    new.av_note:=coalesce(nullif(new.av_note,''),nullif(evidence.av_note,''));
    new.sales_note:=coalesce(nullif(new.sales_note,''),nullif(evidence.sales_note,''));
  else
    new.photos:='[]'::jsonb;
    new.photo_url:=null;
    new.photo_date:=null;
    new.spec:=null;
    new.caliper:=null;
    new.loc_match_pct:=null;
    new.baseline_on_hand:=null;
    new.initial_photo_match_qty:=null;
    new.loc_photo_match:=null;
    new.pick_note:=null;
    new.av_note:=null;
    new.sales_note:=null;
    new.photo_expires_at:=null;
  end if;
  return new;
end
$function$;

do $verify$
declare health jsonb;
begin
  if position('evidence_changed' in pg_get_functiondef(
      'private.sync_master_inventory_canonical_v2362()'::regprocedure))=0 then
    raise exception 'LOCATION_EVIDENCE_REPAIR_CAPTURE_BYPASS_MISSING';
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  health:=public.get_request_drive_evidence_health_snapshot_v1();
  if coalesce((health->>'evidence_mismatch_count')::integer,0)<>0 then
    raise exception 'REQUEST_DRIVE_EVIDENCE_REPAIR_REMAINED:%',health->>'evidence_mismatch_count';
  end if;
end
$verify$;

commit;
