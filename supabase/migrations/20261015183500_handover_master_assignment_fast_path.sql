begin;

-- Inventory has a fixed typed row shape, so avoid serializing every imported
-- inventory tuple to JSON and reparsing it solely to evaluate the two handover
-- eligibility predicates. Other target tables retain the generic path below.
create or replace function private.handover_normalize_assignment_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  h private.scheduled_account_handover_v1;
  cfg record;
  eligible boolean;
  doc jsonb;
  patch jsonb:='{}'::jsonb;
  col text;
  replacement text;
  prior_assignedto text;
  prior_flyer_assigned text;
begin
  select * into h from private.scheduled_account_handover_v1
    where transition_key='kayla_knepp_to_nelly_aguilar_20261002';
  if h.transition_key is null or now()<h.effective_at then return new; end if;

  if tg_table_name='ph_master_inventory' then
    prior_assignedto:=new.assignedto;
    prior_flyer_assigned:=new.flyer_assigned;
    if new.date_completed is null and new.eval_task_completed_at is null then
      replacement:=private.handover_replace_identity_v1(new.assignedto);
      if replacement is distinct from new.assignedto then
        patch:=patch||jsonb_build_object('assignedto',replacement);
        new.assignedto:=replacement;
      end if;
    end if;
    if new.flyer_completed is null then
      replacement:=private.handover_replace_identity_v1(new.flyer_assigned);
      if replacement is distinct from new.flyer_assigned then
        patch:=patch||jsonb_build_object('flyer_assigned',replacement);
        new.flyer_assigned:=replacement;
      end if;
    end if;
    if patch='{}'::jsonb then return new; end if;
    insert into private.scheduled_account_handover_audit_v1(
      transition_key,event_key,event_type,metadata)
    values(h.transition_key,
      'future:ph_master_inventory:'||coalesce(new.unique_id,'')||':'||
        md5(patch::text||coalesce(prior_assignedto,'')||coalesce(prior_flyer_assigned,'')),
      'assignment_transferred',
      jsonb_build_object('table','ph_master_inventory','id',new.unique_id,
        'source','future_assignment','after',patch))
    on conflict(event_key) do nothing;
    return new;
  end if;

  doc:=to_jsonb(new);
  for cfg in select * from private.handover_assignment_targets_v1() where table_name=tg_table_name loop
    execute format('select %s from jsonb_populate_record(null::public.%I,$1) r',cfg.eligibility,cfg.table_name)
      into eligible using doc;
    if not coalesce(eligible,false) then continue; end if;
    foreach col in array cfg.field_names loop
      replacement:=private.handover_replace_identity_v1(doc->>col);
      if replacement is distinct from doc->>col then patch:=patch||jsonb_build_object(col,replacement); end if;
    end loop;
  end loop;
  if patch='{}'::jsonb then return new; end if;
  insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
  values(h.transition_key,'future:'||tg_table_name||':'||coalesce(doc->>'unique_id',doc->>'id',doc->>'itemcode_normalized')||':'||md5(patch::text||coalesce(doc->>'assignedto','')||coalesce(doc->>'flyer_assigned','')),
    'assignment_transferred',jsonb_build_object('table',tg_table_name,'id',coalesce(doc->>'unique_id',doc->>'id',doc->>'itemcode_normalized'),'source','future_assignment','after',patch))
  on conflict(event_key) do nothing;
  new:=jsonb_populate_record(new,patch);
  return new;
end
$$;

revoke all on function private.handover_normalize_assignment_v1() from public,anon,authenticated;

commit;
