-- Supply the recorded post-move state for the historical receipt verification.
begin;
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or exists(select 1 from public.ph_master_inventory where itemcode='006192.010.1') then
    raise exception 'CANONICAL_RECLASS_COMMITTED_FIXTURE_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

set local session_replication_role='replica';
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,contsize,season,saleyear,
  ptronhand,ptrreviewed,ptravailable,s_lts)
values ('ci-reclass-committed-f1','006192.010.1','C.16.000','27.F1','#1','F1','27','220','0','220','150'),
       ('ci-reclass-committed-s1','006192.010.1','C.16.000','27.S1','#1','S1','27','324','0','324','4074'),
       ('ci-reclass-committed-other','006192.010.1','H.03.000','27.S1','#1','S1','27','4000','0','4000','4074');
commit;
