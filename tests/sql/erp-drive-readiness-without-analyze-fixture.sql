-- Caller runs in a rollback transaction after erp-compiled-drive-work-fixture.
-- The second fixture stage is ready, compiled and retains its original seal.
do $readiness$
declare stage uuid:='e3078000-0000-4000-8000-000000000342'; h private.erp_drive_compiled_headers_v3078%rowtype;
  original_sig text; original_digest text;
begin
  select * into strict h from private.erp_drive_compiled_headers_v3078 where stage_id=stage;
  assert h.ready and not h.dirty and h.compiled_rows=h.expected_rows;
  original_sig:=h.checkpoint_hash; original_digest:=h.source_digest;
  if to_regclass('private.erp_drive_final_certificates_v3078') is not null then
    delete from private.erp_drive_final_certificates_v3078 where stage_id=stage;
  end if;
  update private.erp_drive_compiled_headers_v3078 set ready=false where stage_id=stage;
  begin
    delete from private.erp_drive_compiled_rows_v3078 where stage_id=stage and row_number=1;
    -- Bypass the dirtiness witness only inside this negative fixture, so
    -- the nested transaction independently exercises the cardinality check.
    update private.erp_drive_compiled_headers_v3078 set dirty=false where stage_id=stage;
    if to_regprocedure('private.certify_drive_final_input_v3078(uuid)') is not null then
      assert not private.prepare_drive_work_v3078(stage),'first verify source; the next check must find the missing ordinal';
    end if;
    perform private.prepare_drive_work_v3078(stage);
    raise exception 'a physically missing compiled ordinal passed readiness';
  exception when others then if sqlerrm<>'ERP_COMPILED_ROW_COUNT' then raise; end if; end;
  begin
    update private.erp_drive_publication_parts_v3042 set body=replace(body,'second.xlsx','replaced.xlsx') where stage_id=stage;
    perform private.prepare_drive_work_v3078(stage);
    raise exception 'changed original source passed readiness';
  exception when others then if sqlerrm<>'ERP_TYPED_SOURCE_PART_CHANGED' then raise; end if; end;
  assert not private.prepare_drive_work_v3078(stage),'the readiness transaction does not authorize a write receipt';
  if to_regprocedure('private.certify_drive_final_input_v3078(uuid)') is not null then
    assert not private.prepare_drive_work_v3078(stage),'compiled proof remains preparation only';
  end if;
  assert (select ready and not dirty and compiled_rows=expected_rows and source_digest=original_digest and checkpoint_hash=original_sig
    from private.erp_drive_compiled_headers_v3078 where stage_id=stage);
  assert (select committed_result is null and stage_state='staging' from private.fast_erp_stage_runs_v1 where stage_id=stage);
  assert private.prepare_drive_work_v3078(stage),'subsequent invocation may enter canonical publication';
end
$readiness$;
