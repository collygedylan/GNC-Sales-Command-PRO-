-- ERP pick notes alone are not evidence of a user's unfinished Suspend save.
DO $repair$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('private.fast_ingest_snapshot_v2369(regclass,jsonb,text[],boolean)'::regprocedure);
 IF strpos(definition,$before$then ' and not private.soc_tag_has_saved_work_v23188(to_jsonb(target))' else '' end$before$)=0 THEN RAISE EXCEPTION 'ERP_SUSPEND_PRUNE_ANCHOR_MISSING'; END IF;
 EXECUTE replace(definition,$before$then ' and not private.soc_tag_has_saved_work_v23188(to_jsonb(target))' else '' end$before$,$after$then ' and not (private.soc_tag_has_saved_work_v23188(to_jsonb(target)) and (target.date_completed is not null or exists(select 1 from suspend_tag_private.workflows saved where saved.source_uid=target.unique_id and saved.completed_at is not null)))' else '' end$after$);
END $repair$;