begin;
set local lock_timeout='1500ms';
set local statement_timeout='30s';

-- These validated, single-stage witnesses authorize readiness. Global planner
-- statistics remain ordinary background maintenance of the private relation.
do $readiness$
declare d text:=pg_get_functiondef('private.prepare_drive_work_v3078(uuid)'::regprocedure);
  maintenance text:='   analyze private.erp_drive_compiled_rows_v3078 (stage_id,row_number,unique_id,lineage_key,erp_work_cohort);';
begin
  if cardinality(string_to_array(d,maintenance))<>2
    or strpos(d,'perform private.assert_drive_typed_checkpoint_v3077(p_stage);')=0
    or strpos(d,'s.checkpoint_hash is distinct from private.drive_checkpoint_signature_v3078(p_stage)')=0
    or strpos(d,'count(*),min(row_number),max(row_number)')=0
    or strpos(d,'update private.erp_drive_compiled_headers_v3078 set ready=true where stage_id=p_stage;')=0 then
    raise exception 'ERP_COMPILED_READINESS_OWNER_CHANGED';
  end if;
  execute replace(d,maintenance||chr(10),'');
end
$readiness$;
commit;
