-- Disposable baseline replay only. The production repair retains its exact guards.
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or exists(select 1 from public.ph_master_inventory where itemcode='004502.010.1') then
    raise exception 'CANONICAL_FLAME_GRASS_FIXTURE_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,ptronhand,ptravailable)
values ('ci-flame-grass-1','004502.010.1','C.16.000','27.S1','295','295'),
       ('ci-flame-grass-2','004502.010.1','C.16.000','27.F1','200','200'),
       ('ci-flame-grass-3','004502.010.1','F.19.000','27.F1','189','152'),
       ('ci-flame-grass-4','004502.010.1','H.06.000','27.F1','228','228'),
       ('ci-flame-grass-5','004502.010.1','C.17.000','26.F1','17','17');
