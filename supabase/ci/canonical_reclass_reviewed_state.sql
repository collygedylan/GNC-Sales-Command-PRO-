-- Supply the previously committed move state expected by the idempotent repair.
begin;
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or (select count(*) from public.ph_master_inventory where itemcode='004103.010.1'
           and unique_id like 'ci-reclass-juncus-%' and lotcode in ('27.F1','27.S1'))<>6 then
    raise exception 'CANONICAL_RECLASS_REVIEWED_STATE_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

set local session_replication_role='replica';
update public.ph_master_inventory master
set ptronhand=reviewed.on_hand,ptrreviewed='0',ptravailable=reviewed.on_hand,s_lts=reviewed.open_stock,
  season_oh=reviewed.season_on_hand
from (values
  ('ci-reclass-juncus-f1','529','253','643'),('ci-reclass-juncus-f16-f1','113','253','643'),
  ('ci-reclass-juncus-h06-f1','1','253','643'),('ci-reclass-juncus-s1','279','0','2050'),
  ('ci-reclass-juncus-f16-s1','175','0','2050'),('ci-reclass-juncus-i03-s1','1596','0','2050')
) reviewed(unique_id,on_hand,open_stock,season_on_hand)
where master.unique_id=reviewed.unique_id and master.itemcode='004103.010.1';
commit;
