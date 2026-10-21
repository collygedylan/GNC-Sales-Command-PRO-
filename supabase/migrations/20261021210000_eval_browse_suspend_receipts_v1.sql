begin;
set local lock_timeout = '1s';
-- Extend the already authorized, set-based report read with a compact browse index.
-- No new grant, startup route, inventory write, or historical job is introduced.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure);
 if position('browseColumns' in definition)=0 then
  if position($old$      'reportMatchCount',(select count(*) from classified where cardinality(report_ids)>0),$old$ in definition)=0 then raise exception 'EVAL_BROWSE_PATCH_ANCHOR_MISSING'; end if;
  definition:=replace(definition,$old$      'reportMatchCount',(select count(*) from classified where cardinality(report_ids)>0),$old$,$new$      'reportMatchCount',(select count(*) from classified where cardinality(report_ids)>0),
      'browseColumns',to_jsonb(array['unique_id','itemcode','commonname','contsize','locationcode','lotcode','season','blockalpha','assignedto','ptronhand','ptravailable','ptrreviewed','s_lts','priority','reportIds','holdstopcode','holdstopreason','photo_link','photo_name','av_note','itemspec','genusname','locationnotedate']),
      'browseRows',case when surface='eval2' and operation='groups' and page_offset=0
        and coalesce(filters->>'itemCode','')='' and coalesce(filters->>'uniqueId','')=''
        then (select coalesce(jsonb_agg(jsonb_build_array(c.unique_id,c.itemcode,c.commonname,c.contsize,c.locationcode,c.lotcode,c.season,private.manager_report_block_key_v1(surface,c.blockalpha,c.locationcode),c.assignedto,c.ptronhand,c.ptravailable,c.ptrreviewed,c.s_lts,c.priority,c.report_ids,c.holdstopcode,c.holdstopreason,c.photo_link,c.photo_name,c.av_note,c.itemspec,c.genusname,c.locationnotedate)),'[]'::jsonb) from classified c) else null end,
      'evaluatorDirectory',(select coalesce(jsonb_agg(username order by username),'[]'::jsonb) from (
        select assignedto username from active_assignment_users
        union select lower(btrim(username)) from public.user_access_control where active and canonical_role in ('eval','evaluator')
      ) users),$new$);
  execute definition;
 end if;
 definition:=pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
 if position('removed_false_block' in definition)=0 then
  if position($old$   result:=jsonb_build_object('ok',true);
 elsif p_operation='send' then$old$ in definition)=0 then raise exception 'SUSPEND_RECEIPT_PATCH_ANCHOR_MISSING'; end if;
  definition:=replace(definition,$old$   result:=jsonb_build_object('ok',true);
 elsif p_operation='send' then$old$,$new$   result:=jsonb_build_object('ok',true,
     'added_rows',(select count(*) from public.ph_soc_master c where c.suspend_candidate_group=group_key and c.last_updated=stamp and c.suspend_candidate_state='candidate'),
     'removed_false_block',exists(select 1 from public.ph_soc_master c where c.suspend_candidate_group=group_key and c.locationcode='0.00.111' and c.suspend_candidate_state='replaced'));
 elsif p_operation='send' then$new$);
  execute definition;
 end if;
end $migration$;
notify pgrst, 'reload schema';
commit;
