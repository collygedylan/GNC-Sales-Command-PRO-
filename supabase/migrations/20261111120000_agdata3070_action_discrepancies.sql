begin;
set local lock_timeout='4s';
set local statement_timeout='30s';

create table public.app_row_actions (
  id bigint generated always as identity primary key, canonical_unique_id text not null,
  baseline_erp_row jsonb, app_update_action jsonb not null, app_update_row jsonb not null,
  changed_fields text[] not null, rule_scope jsonb not null, created_at timestamptz not null default clock_timestamp(),
  absorbed_by_erp boolean not null default false, reconciliation_status text not null default 'pending'
    check (reconciliation_status in ('pending','matched','discrepant','superseded')), sync_run_id uuid
);
create index app_row_actions_pending_uid on public.app_row_actions(canonical_unique_id,id) where reconciliation_status='pending';
create index app_row_actions_season on public.app_row_actions((app_update_row->>'itemcode'),
  private.inventory_stock_season_v1(app_update_row->>'lotcode',app_update_row->>'season')) where changed_fields && array['s_lts','season_oh'];
create index app_row_actions_command_uid on public.app_row_actions((app_update_action->>'command_id'),canonical_unique_id)
  where app_update_action ? 'command_id';
create table public.ph_action_learning_rules (
  id bigint generated always as identity primary key, action_type text not null, rule_scope jsonb not null,
  field_transition_formula jsonb not null, sample_count integer not null default 1,
  teachable boolean not null, auto_apply_enabled boolean not null default false check (not auto_apply_enabled or teachable),
  taught_by uuid, taught_at timestamptz,
  formula_digest bytea generated always as (extensions.digest(field_transition_formula::text,'sha256')) stored,
  unique(action_type,rule_scope,formula_digest)
);
create unique index ph_action_learning_enabled on public.ph_action_learning_rules(action_type,rule_scope) where auto_apply_enabled;
create table public.ph_action_discrepancies (
  id bigint generated always as identity primary key, action_id bigint not null unique references public.app_row_actions,
  itemcode text, commonname text, contsize text, locationcode text, lotcode text, target_lotcode text, target_locationcode text,
  action_type text not null, app_update_row jsonb not null, app_update_action jsonb not null, report_update_row jsonb not null,
  discrepancy_diff jsonb not null, source_file_name text not null, sync_run_id uuid not null, import_run_id uuid not null,
  rule_id bigint references public.ph_action_learning_rules, status text not null default 'open' check(status in ('open','learned','reviewed')),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.app_row_actions enable row level security;
alter table public.ph_action_learning_rules enable row level security;
alter table public.ph_action_discrepancies enable row level security;
revoke all on public.app_row_actions,public.ph_action_learning_rules,public.ph_action_discrepancies from public,anon,authenticated,service_role;

-- The Drive staging schema defines report-owned columns. Location notes and all
-- provenance, derived evidence, and identifiers outside the report stay private to their owners.
create function private.action_snapshot_v3070(r jsonb) returns jsonb language sql stable set search_path='' as $$
  select jsonb_object_agg(j.key,j.value) from jsonb_each(r) j join pg_catalog.pg_attribute a on a.attname=j.key
  where a.attrelid='app_sync_private.ph_master_snapshot_stage_rows_v1'::regclass and a.attnum>0 and not a.attisdropped
    and j.key<>all(array['request_id','row_number','raw_values','raw_item6_count','raw_item6_fields','field_keys','lineage_key',
      'source_hash','stable_identity_key','last_updated','filename','unique_id','concat','locationnote','locationnotedate'])
$$;
create function private.action_diff_v3070(b jsonb,e jsonb,r jsonb) returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('field',f.key,'baseline_value',b->f.key,
    'app_expected_value',e->f.key,'report_actual_value',f.value,'delta',case when numeric_field
    and e->>f.key ~ '^-?[0-9]+([.][0-9]+)?$' and r->>f.key ~ '^-?[0-9]+([.][0-9]+)?$'
    then (r->>f.key)::numeric-(e->>f.key)::numeric end) order by f.key),'[]')
  from jsonb_each(r) f cross join lateral (select f.key=any(array['ptronhand','ptravailable','ptrreviewed','s_lts',
    'season_oh','season_available','oversellpercentage']) numeric_field) kind
  where e ? f.key and not private.inventory_override_matches_v1(case when numeric_field then 'ptravailable' else f.key end,f.value,e->f.key)
$$;
create function private.action_formula_v3070(d jsonb) returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_object_agg(v->>'field',case when v->>'field'=any(array[
    'itemcode','locationcode','lotcode','season','saleyear','warehouseid','source','desigitem','desigcust','desigloc',
    'contsize','commonname','blockalpha','blocknumber','bay'])
    then jsonb_build_object('observe_from',v->'app_expected_value','observe_to',v->'report_actual_value')
    when v->'delta'<>'null'::jsonb then jsonb_build_object('add',v->'delta')
      else jsonb_build_object('from',v->'app_expected_value','set',v->'report_actual_value') end),'{}')
  from jsonb_array_elements(d) v
$$;
create function private.apply_action_formula_v3070(r jsonb,f jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare op record; result jsonb:=r; n numeric;
begin
  for op in select * from jsonb_each(f) loop
    if op.value ? 'add' then
      if coalesce(r->>op.key,'') !~ '^-?[0-9]+([.][0-9]+)?$' then return r; end if;
      n:=(r->>op.key)::numeric+(op.value->>'add')::numeric;
      if n<0 then return r; end if;
      result:=result||jsonb_build_object(op.key,n::text);
    elsif r->op.key is not distinct from op.value->'from' then
      result:=result||jsonb_build_object(op.key,op.value->'set');
    else return r;
    end if;
  end loop;
  return result;
end $$;

-- Command-scoped movement legs are constructed only after canonical UID and quantity validation.
create function private.action_move_map_v3070(legs jsonb,actor uuid,cmd text) returns text language sql immutable set search_path='' as $$
  with sides as (select v, x.uid,x.side from jsonb_array_elements(legs) v
    cross join lateral (values(v->>'from_uid','source'),(v->>'to_uid','target')) x(uid,side)),
  grouped as (select uid,side,jsonb_agg(v order by v->>'to_uid',v->>'direction') legs,sum((v->>'quantity')::numeric) qty,
    case when count(distinct v->>'direction')=1 then min(v->>'direction') else 'reclass' end typ from sides group by uid,side)
  select jsonb_object_agg(uid,jsonb_build_object('action_type',typ,'side',side,'quantity',qty,'legs',legs,
    'actor',actor,'command_id',cmd,'source_lotcode',legs#>>'{0,from_lot}','source_locationcode',legs#>>'{0,from_location}',
    'target_lotcode',case when jsonb_array_length(legs)=1 then legs#>>'{0,to_lot}' end,
    'target_locationcode',case when jsonb_array_length(legs)=1 then legs#>>'{0,to_location}' end))::text from grouped
$$;
create function private.capture_action_v3070(b jsonb,r jsonb,actor text) returns jsonb language plpgsql set search_path='' as $$
declare before_row jsonb:=private.action_snapshot_v3070(b); expected jsonb:=private.action_snapshot_v3070(r);
  meta jsonb:=nullif(current_setting('gnc.row_actions_v3070',true),'')::jsonb;
  fields text[]; typ text; scope jsonb; learned jsonb; uid text:=r->>'unique_id'; change jsonb; prior public.app_row_actions;
begin
  meta:=coalesce(meta->uid,meta->'command','{}');
  if meta ? 'source_uid' then
    meta:=meta||jsonb_build_object('side',case when meta->>'source_uid'=uid then 'source'
      when meta->>'target_uid'=uid then 'target' else 'row' end);
  end if;
  if actor='system' and meta='{}' and b is null then return r; end if;
  select array_agg(k order by k) into fields from jsonb_object_keys(expected) k
    where case when b is null then expected->k<>'null'::jsonb else expected->k is distinct from before_row->k end;
  if fields is null then return r; end if;
  if meta ? 'command_id' then
    select * into prior from public.app_row_actions where canonical_unique_id=uid and app_update_action ? 'command_id'
      and app_update_action->>'command_id'=meta->>'command_id' and app_update_action->>'actor'=meta->>'actor'
      and reconciliation_status='pending' order by id desc limit 1;
    if found then
      select array_agg(k order by k) into fields from jsonb_object_keys(expected) k where expected->k is distinct from prior.baseline_erp_row->k
        and (prior.baseline_erp_row is not null or expected->k<>'null'::jsonb);
      update public.app_row_actions set app_update_row=expected,changed_fields=coalesce(fields,'{}'),
        app_update_action=prior.app_update_action||jsonb_build_object('changed_fields',coalesce(fields,'{}')) where id=prior.id;
      return r;
    end if;
  end if;
  typ:=coalesce(meta->>'action_type',case when fields && array['lotcode','locationcode'] then 'location_move'
    when fields && array['holdstopcode','holdstopreason'] then 'hold_stop_edit' when 'priority'=any(fields) then 'priority_change'
    when fields && array['s_lts','season_oh'] then 'season_stock' else 'inventory_edit' end);
  -- Only this command shape, side and quantity may receive a reviewed transformation.
  scope:=jsonb_strip_nulls(jsonb_build_object('side',meta->'side','quantity',meta->'quantity','fields',fields,
    'priority',case when 'priority'=any(fields) then expected->'priority' end,
    'hold',case when 'holdstopcode'=any(fields) then expected->'holdstopcode' end,
    'source_season',substring(meta->>'source_lotcode' from '[.]([^.]+)$'),'target_season',substring(meta->>'target_lotcode' from '[.]([^.]+)$')));
  select field_transition_formula into learned from public.ph_action_learning_rules
    where action_type=typ and rule_scope=scope and auto_apply_enabled;
  if learned is not null then expected:=private.apply_action_formula_v3070(expected,learned); end if;
  select array_agg(k order by k) into fields from jsonb_object_keys(expected) k
    where expected->k is distinct from before_row->k and (before_row is not null or expected->k<>'null'::jsonb);
  if fields is null then return r; end if;
  change:=meta||jsonb_build_object('action_type',typ,'actor',coalesce(meta->>'actor',actor),'timestamp',clock_timestamp(),
    'parameters',(select jsonb_object_agg(k,jsonb_build_object('from',before_row->k,'to',expected->k)) from unnest(fields) k),
    'summary',concat_ws(' ',initcap(replace(typ,'_',' ')),meta->>'quantity',
      case when meta ? 'source_lotcode' then concat_ws(' ','from',meta->>'source_lotcode','to',meta->>'target_lotcode') end,
      'on',r->>'commonname',r->>'contsize','at',r->>'locationcode'),'changed_fields',fields);
  insert into public.app_row_actions(canonical_unique_id,baseline_erp_row,app_update_action,app_update_row,changed_fields,rule_scope)
    values(uid,before_row,change,expected,fields,scope);
  return r||expected;
end $$;

create function private.record_discrepancy_v3070(a public.app_row_actions,r jsonb,d jsonb,filename text,run_id uuid)
returns void language plpgsql set search_path='' as $$
declare formula jsonb:=private.action_formula_v3070(d); rule bigint; act jsonb:=a.app_update_action;
begin
  if formula<>'{}' then
    insert into public.ph_action_learning_rules as existing(action_type,rule_scope,field_transition_formula,teachable)
      values(act->>'action_type',a.rule_scope,formula,not (a.rule_scope ? 'legacy')
        and not exists(select 1 from jsonb_each(formula) f where f.value ? 'observe_to'))
      on conflict(action_type,rule_scope,formula_digest) do update set sample_count=existing.sample_count+1
        where existing.field_transition_formula=excluded.field_transition_formula returning id into strict rule;
  end if;
  insert into public.ph_action_discrepancies(action_id,itemcode,commonname,contsize,locationcode,lotcode,target_lotcode,
    target_locationcode,action_type,app_update_row,app_update_action,report_update_row,discrepancy_diff,source_file_name,sync_run_id,import_run_id,rule_id)
  values(a.id,r->>'itemcode',a.app_update_row->>'commonname',a.app_update_row->>'contsize',coalesce(act->>'source_locationcode',r->>'locationcode'),
    coalesce(act->>'source_lotcode',r->>'lotcode'),coalesce(act->>'target_lotcode',a.app_update_row->>'lotcode'),
    coalesce(act->>'target_locationcode',a.app_update_row->>'locationcode'),act->>'action_type',a.app_update_row,act,r,d,filename,
    coalesce(nullif(current_setting('agdata.erp.sync_job_v3070',true),'')::uuid,run_id),run_id,rule);
end $$;

-- Fold a chain of edits in command order. A report can acknowledge an intermediate
-- edit while a newer revision of the same physical row stays pending.
create function private.reconcile_action_row_v3070(uid text,r jsonb,filename text,run_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare a public.app_row_actions; last_action public.app_row_actions; first_state jsonb; last_match bigint;
  pending_fields text[]:='{}'; required_fields text[]; all_present boolean:=true; patch jsonb:='{}'; diff jsonb; cutoff bigint;
begin
  for a in select * from public.app_row_actions where canonical_unique_id=uid and reconciliation_status='pending' order by id for update loop
    if last_action.id is null then first_state:=a.baseline_erp_row; end if;
    required_fields:=case when a.baseline_erp_row is null then array['itemcode','lotcode','locationcode','ptronhand'] else a.changed_fields end;
    all_present:=all_present and r ?& required_fields;
    if all_present and private.action_diff_v3070(null,a.app_update_row,r)='[]' then last_match:=a.id; end if;
    pending_fields:=pending_fields||a.changed_fields;
    last_action:=a;
  end loop;
  if last_action.id is null then return '{}'; end if;
  if last_match is not null then
    update public.app_row_actions set reconciliation_status='matched',absorbed_by_erp=true,sync_run_id=run_id
      where canonical_unique_id=uid and reconciliation_status='pending' and id<=last_match;
    cutoff:=last_match;
  elsif all_present and (first_state is null or private.action_diff_v3070(null,first_state,r)<>'[]') then
    diff:=private.action_diff_v3070(first_state,last_action.app_update_row,r);
    perform private.record_discrepancy_v3070(last_action,r,diff,filename,run_id);
    update public.app_row_actions set reconciliation_status=case when id=last_action.id then 'discrepant' else 'superseded' end,
      absorbed_by_erp=true,sync_run_id=run_id where canonical_unique_id=uid and reconciliation_status='pending' and id<=last_action.id;
    cutoff:=last_action.id;
  end if;
  select coalesce(jsonb_object_agg(k,r->k),'{}') into patch from (select distinct unnest(pending_fields) k) f where r ? k;
  -- Override only fields covered by these actions, keeping older evidence outside
  -- the action's ownership in its existing durable owner.
  for a in select * from public.app_row_actions where canonical_unique_id=uid and reconciliation_status='pending' order by id loop
    patch:=patch||(select jsonb_object_agg(k,a.app_update_row->k) from unnest(a.changed_fields) k);
  end loop;
  if cutoff is not null then
    update app_sync_private.inventory_live_overrides_v1 o set pending=false,latest_erp_value=r->field_name,
      reconciled_at=clock_timestamp(),updated_at=clock_timestamp() where canonical_unique_id=uid and pending and field_name=any(pending_fields)
      and r ? field_name and not exists(select 1 from public.app_row_actions later where later.canonical_unique_id=uid
        and later.reconciliation_status='pending' and o.field_name=any(later.changed_fields));
  end if;
  return patch;
end $$;

create function private.publish_actions_v3070(run_id uuid) returns void language plpgsql set search_path='' as $$
declare rec record; patch jsonb; assignments text;
begin
  if not exists(select 1 from public.app_row_actions where reconciliation_status='pending') then return; end if;
  -- Rekeyed workbook IDs can follow an exact old/new physical tuple through a location move.
  -- Competing physical rows or multiple workbook candidates retain the normal ambiguity guards.
  with aliases as materialized (select distinct a.canonical_unique_id,private.ph_master_inventory_lineage_key_v1(snap) lineage
    from public.app_row_actions a cross join lateral (values(a.baseline_erp_row),(a.app_update_row)) x(snap)
    where a.reconciliation_status='pending' and a.changed_fields && array['lotcode','locationcode'] and snap is not null),
  candidates as (select s.row_number,a.canonical_unique_id,count(*) over(partition by s.row_number) row_options,
      count(*) over(partition by a.canonical_unique_id) uid_options
    from aliases a join pg_temp.ph_master_bulk_stage_v1 s on s.lineage_key=a.lineage
    join pg_temp.ph_master_bulk_map_v1 m using(row_number)
    where m.candidate_count=0 and m.canonical_unique_id is null
      and not exists(select 1 from pg_temp.ph_master_bulk_map_v1 used where used.canonical_unique_id=a.canonical_unique_id))
  update pg_temp.ph_master_bulk_map_v1 m set canonical_unique_id=c.canonical_unique_id,candidate_count=1
    from candidates c where c.row_options=1 and c.uid_options=1 and m.row_number=c.row_number;
  for rec in
    select m.canonical_unique_id uid,s.row_number,s.raw_values,s.filename from pg_temp.ph_master_bulk_map_v1 m
      join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
      join (select distinct canonical_unique_id from public.app_row_actions where reconciliation_status='pending') a using(canonical_unique_id)
    where m.candidate_count=1 and not exists(select 1 from pg_temp.ph_master_bulk_map_v1 other
      where other.canonical_unique_id=m.canonical_unique_id and other.row_number<>m.row_number)
      and exists(select 1 from public.app_row_actions h where h.canonical_unique_id=m.canonical_unique_id and h.reconciliation_status='pending'
        and s.itemcode=h.app_update_row->>'itemcode' and (s.unique_id=m.canonical_unique_id
        or (s.locationcode,s.lotcode) in ((h.baseline_erp_row->>'locationcode',h.baseline_erp_row->>'lotcode'),
          (h.app_update_row->>'locationcode',h.app_update_row->>'lotcode'))))
    order by m.canonical_unique_id
  loop
    patch:=private.reconcile_action_row_v3070(rec.uid,private.action_snapshot_v3070(rec.raw_values),coalesce(rec.raw_values->>'filename',rec.filename),run_id);
    select string_agg(format('%1$I=p.%1$I',k),',') into assignments from jsonb_object_keys(patch) k
      join pg_catalog.pg_attribute att on att.attname=k and att.attrelid='pg_temp.ph_master_bulk_stage_v1'::regclass;
    if assignments is not null then execute format('update pg_temp.ph_master_bulk_stage_v1 s set %s
      from jsonb_populate_record(null::public.ph_master_inventory,$1) p where s.row_number=$2',assignments) using patch,rec.row_number; end if;
  end loop;
  update private.ph_inventory_reclass_movements_v1 m set status='acknowledged',conflict_reason=null,updated_at=clock_timestamp()
    from private.ph_inventory_reclass_commands_v1 c where c.request_id=m.request_id and m.status in ('pending','conflict')
    and (m.conflict_reason is null or m.conflict_reason in ('incoming_state_ambiguous','target_quantity_changed'))
    and exists(select 1 from public.app_row_actions a where a.canonical_unique_id=m.source_unique_id
      and a.app_update_action->>'command_id'=c.command_id and a.absorbed_by_erp)
    and exists(select 1 from public.app_row_actions a where a.canonical_unique_id=m.destination_unique_id
      and a.app_update_action->>'command_id'=c.command_id and a.absorbed_by_erp);
end $$;

create function private.manager_discrepancy_row_v3070(d public.ph_action_discrepancies) returns jsonb language sql stable set search_path='' as $$
  select to_jsonb(d)||jsonb_build_object('learned_rule',(select jsonb_build_object('field_transition_formula',r.field_transition_formula,
    'sample_count',r.sample_count,'auto_apply_enabled',r.auto_apply_enabled,'teachable',r.teachable) from public.ph_action_learning_rules r where r.id=d.rule_id))
$$;
create function public.manager_action_discrepancies_v3070(p_actor_id uuid,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.ph_action_discrepancies; rule public.ph_action_learning_rules; result jsonb; n integer;
begin
  if coalesce(auth.role(),'')<>'service_role' or not coalesce(private.user_access_has_permission_v1(p_actor_id,'can_access_manager_tab'),false)
    then raise exception using errcode='42501',message='MANAGER_ACCESS_REQUIRED'; end if;
  if p_operation='read' then
    n:=least(250,greatest(1,coalesce((p_payload->>'limit')::int,100)));
    with page as materialized(select * from public.ph_action_discrepancies where id<coalesce((p_payload->>'before_id')::bigint,9223372036854775807)
      order by id desc limit n+1), shown as (select * from page order by id desc limit n)
    select jsonb_build_object('rows',coalesce(jsonb_agg(private.manager_discrepancy_row_v3070(shown) order by id desc),'[]'),
      'next_before_id',case when (select count(*) from page)>n then min(id) end) into result from shown;
    return result;
  end if;
  if p_operation not in ('teach','review') or p_operation is null then raise exception 'INVALID_DISCREPANCY_OPERATION'; end if;
  select * into strict d from public.ph_action_discrepancies where id=(p_payload->>'id')::bigint for update;
  if p_operation='teach' then
    select * into strict rule from public.ph_action_learning_rules where id=d.rule_id;
    if not rule.teachable then raise exception using errcode='22023',message='OBSERVATION_ONLY_RULE'; end if;
    -- Serialize mutually exclusive promotions, including when two Managers teach different samples.
    perform pg_advisory_xact_lock(hashtextextended(rule.action_type||rule.rule_scope::text,3070));
    update public.ph_action_learning_rules set auto_apply_enabled=false where action_type=rule.action_type and rule_scope=rule.rule_scope
      and id<>rule.id and auto_apply_enabled;
    update public.ph_action_learning_rules set auto_apply_enabled=true,taught_by=p_actor_id,taught_at=clock_timestamp()
      where id=rule.id and not auto_apply_enabled;
  end if;
  update public.ph_action_discrepancies set status=case when p_operation='teach' then 'learned' when status='learned' then status else 'reviewed' end
    where id=d.id returning * into d;
  return jsonb_build_object('row',private.manager_discrepancy_row_v3070(d));
end $$;
revoke all on function public.manager_action_discrepancies_v3070(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manager_action_discrepancies_v3070(uuid,text,jsonb) to service_role;


-- Wire the existing validated entry points without changing their callers or receipts.
-- Every replacement must match exactly once or the migration rolls back.
do $wiring$
declare spec record; definition text; replacement text; exit_anchor text;
begin
  for spec in select * from (values
    ('private.reconcile_inventory_live_overrides_v1()', ' foreach field in array array[',
      $capture$ if tg_table_name='ph_master_inventory' then
   result:=private.capture_action_v3070(case when tg_op='UPDATE' then to_jsonb(old) end,result,actor);
   new:=jsonb_populate_record(new,result);
 end if;
$capture$),
    ('public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)', '  update public.ph_master_inventory m set',
      $single$  perform set_config('gnc.row_actions_v3070',private.action_move_map_v3070((select jsonb_agg(jsonb_build_object(
    'from_uid',p_source_uid,'from_lot',source_row.lotcode,'from_location',source_row.locationcode,
    'to_uid',t.destination_uid,'to_lot',t.destination_lot,'to_location',source_row.locationcode,
    'direction',l->>'direction','quantity',l->'quantity')) from jsonb_array_elements(p_lines) l
    join pg_temp.reclass_move_targets_v1 t on t.destination_season=upper(btrim(l->>'destinationSeason'))),p_actor_id,p_command_id),true);
$single$),
    ('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)', '  with updated_sources as (',
      $multi$  perform set_config('gnc.row_actions_v3070',(select jsonb_object_agg(entry.key,entry.value)::text from (
    select private.action_move_map_v3070(jsonb_agg(jsonb_build_object('from_uid',s.source_uid,'from_lot',b.lotcode,
      'from_location',b.locationcode,'to_uid',t.destination_uid,'to_lot',t.destination_lot,'to_location',b.locationcode,
      'direction',l.direction,'quantity',l.quantity)),p_actor_id,s.child_command)::jsonb as per_source
    from pg_temp.reclass_batch_sources_v1 s join pg_temp.reclass_batch_source_before_v1 b using(source_index)
    join pg_temp.reclass_batch_lines_v1 l using(source_index) join pg_temp.reclass_batch_targets_v1 t using(source_index,destination_season)
    group by s.source_index,s.child_command) groups cross join lateral jsonb_each(per_source) entry),true);
$multi$),
    ('public.apply_inventory_transaction_v1(uuid,text,jsonb,jsonb,jsonb)', '  -- Stable lock ordering',
      $transaction$  perform set_config('gnc.row_actions_v3070',jsonb_build_object('command',jsonb_build_object('action_type',p_audit->>'action',
    'actor',actor.id,'command_id',p_command_id,'quantity',p_audit->'quantity','source_uid',p_audit->'source_unique_id',
    'target_uid',p_audit->'destination_unique_id','source_lotcode',p_audit->'source_lotcode',
    'target_lotcode',p_audit->'destination_lotcode','source_locationcode',p_audit->'source_locationcode',
    'target_locationcode',p_audit->'destination_locationcode'))::text,true);
$transaction$),
    ('private.apply_inventory_live_overrides_bulk_v1(uuid)', E'\nend\n', E'\n  perform private.publish_actions_v3070(p_run_id);\n')
  ) s(proc,anchor,addition) loop
    definition:=pg_get_functiondef(spec.proc::regprocedure);
    -- The single-move owner also updates its destination inside its loop.
    if spec.proc like 'public.apply_inventory_reclass_move_v1(%' then
      spec.anchor:=spec.anchor||E'\n    ptronhand=(before_source_on_hand-total_quantity)::text,';
    end if;
    if cardinality(string_to_array(definition,spec.anchor))<>2 then raise exception 'ACTION_OWNER_DRIFT %',spec.proc; end if;
    replacement:=spec.addition||spec.anchor;
    if spec.addition like '%set_config(''gnc.row_actions_v3070''%' then
      exit_anchor:=case when spec.proc like 'public.apply_inventory_reclass_move_v1(%' then '  rows_value := jsonb_build_array'
        when spec.proc like 'private.apply_inventory_reclass_moves_set_v1(%' then '  select revision into current_revision'
        else '  audit_record:=p_audit||' end;
      if cardinality(string_to_array(definition,exit_anchor))<>2 or cardinality(string_to_array(definition,E'\ndeclare'))<>2
        then raise exception 'ACTION_COMMAND_SCOPE_DRIFT %',spec.proc; end if;
      definition:=replace(definition,E'\ndeclare',E'\ndeclare prior_action_context text:=coalesce(current_setting(''gnc.row_actions_v3070'',true),'''');\n');
      definition:=replace(definition,exit_anchor,E'  perform set_config(''gnc.row_actions_v3070'',prior_action_context,true);\n'||exit_anchor);
    end if;
    execute replace(definition,spec.anchor,replacement);
  end loop;
end $wiring$;

-- Migrate outstanding movement receipts with their original author, legs and timestamps.
with legs as (select c.actor_id,c.command_id,c.created_at,m.*,jsonb_build_object('from_uid',m.source_unique_id,
  'from_lot',m.source_identity->>'lotcode','from_location',m.source_identity->>'locationcode','to_uid',m.destination_unique_id,
  'to_lot',m.destination_identity->>'lotcode','to_location',m.destination_identity->>'locationcode',
  'direction',m.direction,'quantity',m.quantity) leg from private.ph_inventory_reclass_movements_v1 m
  join private.ph_inventory_reclass_commands_v1 c using(request_id) where m.status='pending'),
maps as (select request_id,private.action_move_map_v3070(jsonb_agg(leg order by line_index),actor_id,command_id)::jsonb actions
  from legs group by request_id,actor_id,command_id),
sides as (select distinct on (l.request_id,x.uid) x.uid,x.before_row,x.after_row,l.created_at,maps.actions->x.uid act
  from legs l join maps using(request_id) cross join lateral (values(l.source_unique_id,l.source_before,l.source_after),
    (l.destination_unique_id,l.destination_before,l.destination_after)) x(uid,before_row,after_row)
  order by l.request_id,x.uid,l.line_index desc)
insert into public.app_row_actions(canonical_unique_id,baseline_erp_row,app_update_row,app_update_action,rule_scope,changed_fields,created_at)
  select uid,private.action_snapshot_v3070(before_row),private.action_snapshot_v3070(after_row),
    act||jsonb_build_object('timestamp',created_at,'summary',concat_ws(' ',initcap(replace(act->>'action_type','_',' ')),
      act->>'quantity','from',act->>'source_lotcode','to',act->>'target_lotcode','on',after_row->>'commonname',after_row->>'contsize',
      'at',after_row->>'locationcode')),jsonb_build_object('side',act->'side','quantity',act->'quantity','fields',fields,
        'source_season',substring(act->>'source_lotcode' from '[.]([^.]+)$'),'target_season',substring(act->>'target_lotcode' from '[.]([^.]+)$')),
    fields,created_at from sides cross join lateral (select array_agg(key order by key) fields from jsonb_each(private.action_snapshot_v3070(after_row))
      where value is distinct from before_row->key and (before_row is not null or value<>'null'::jsonb)) changes
  where fields is not null order by sides.created_at;

-- For older field edits the durable overrides prove only individual ERP values.
-- Preserve that evidence without synthesizing an unrelated full historical row.
with old_edits as (select o.* from app_sync_private.inventory_live_overrides_v1 o
  where o.pending and o.updated_by<>'system' and o.field_name in ('priority','holdstopcode','holdstopreason','holdstopbegindate',
    'holdstopenddate','ptronhand','ptravailable','ptrreviewed','s_lts','season_oh','locationptn1','desigitem','desigcust','desigloc',
    'pullerresponsibility','oversellpercentage','salesnote','suspend') and not exists(select 1 from public.app_row_actions a
      where a.canonical_unique_id=o.canonical_unique_id and o.field_name=any(a.changed_fields))),
edits as (select canonical_unique_id,case when count(distinct updated_by)=1 then min(updated_by) end actor,
  jsonb_object_agg(field_name,jsonb_build_object('actor',updated_by,'at',updated_at)) field_actors,min(updated_at) first_edit,
  array_agg(field_name order by field_name) fields,jsonb_object_agg(field_name,erp_baseline_value) baseline,
  jsonb_object_agg(field_name,app_override_value) expected from old_edits group by 1)
insert into public.app_row_actions(canonical_unique_id,baseline_erp_row,app_update_row,app_update_action,rule_scope,changed_fields,created_at)
  select e.canonical_unique_id,identity_row||baseline,identity_row||expected,
    jsonb_build_object('action_type','legacy_inventory_edit','actor',actor,'field_actors',field_actors,'timestamp',first_edit,'changed_fields',fields,
      'summary',concat_ws(' ','Prior inventory edit on',m.commonname,m.contsize,'at',m.locationcode,m.lotcode)),
    '{"legacy":true}',fields,first_edit from edits e join public.ph_master_inventory m on m.unique_id=e.canonical_unique_id
    cross join lateral (select jsonb_build_object('itemcode',m.itemcode,'commonname',m.commonname,'contsize',m.contsize,
      'lotcode',m.lotcode,'locationcode',m.locationcode) identity_row) row_identity order by first_edit;

do $grants$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname like '%\_v3070' escape '\'
      and p.proname in ('action_snapshot_v3070','action_diff_v3070','action_formula_v3070','apply_action_formula_v3070',
        'capture_action_v3070','action_move_map_v3070','record_discrepancy_v3070','publish_actions_v3070',
        'reconcile_action_row_v3070','manager_discrepancy_row_v3070')
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn); end loop;
end $grants$;
commit;
