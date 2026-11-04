-- Run against the installed release in one transaction. All fixture changes roll back.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL request.jwt.claim.role='service_role';
DO $p$ DECLARE actor uuid; result jsonb; cmd uuid:=gen_random_uuid(); payload jsonb; m public.ph_master_inventory; tag public.ph_soc_master; quantity text; BEGIN
 select id into strict actor from public.profiles where username='dylan_collyge' and disabled_at is null limit 1;
 perform set_config('app.suspend_tag_actor_id',actor::text,true);
 select * into m from public.ph_master_inventory where locationcode is not null limit 1;
 m.unique_id:='v23158-probe-target';m.itemcode:='990158.031.1';m.concat:='v23158-probe-target';m.locationcode:='F.14.000';m.lotcode:='27.F1';m.ptrreviewed:='2';m.photo_url:=null;m.photo_link:=null;m.spec:=null;m.av_note:=null;
 insert into public.ph_master_inventory select (m).*;
 select * into tag from public.ph_soc_master where upper(suspend)='SUSPEND' limit 1;
 tag.unique_id:='v23158-probe-tag';tag.concat:='v23158-probe-tag';tag.itemcode:='990158.015.1';tag.transactionnumber:='v23158-probe';tag.locationcode:='0.00.111';tag.suspend_to:='ms';tag.quantityordered:='3';tag.dock:='TEST';tag.dock_num:='TEST';tag.stopnumber:='9';tag.lotcode:='27.F1';tag.date_completed:=null;tag.suspend_candidate_state:=null;tag.suspend_candidate_group:=null;tag.suspend_origin_uid:=null;tag.dock_photo_link:=null;tag.match:=null;tag.dock_spec:=null;tag.av_note:=null;
 insert into public.ph_soc_master select (tag).*;
 payload:=jsonb_build_object('sourceUid',tag.unique_id,'sourceIdentity',jsonb_build_object('locationcode','0.00.111','lotcode','27.F1'),'inventoryIds',jsonb_build_array(m.unique_id));
 result:=suspend_tag_private.group_command(actor,'replace_location',payload,cmd,null);
 if result->'rows'->0->>'locationcode' IS DISTINCT FROM 'F.14.000' or result->'rows'->0->>'unique_id'<>tag.unique_id or result->'rows'->0->>'stopnumber'<>'9' or result->'inventoryRows'->0->>'ptrreviewed' IS DISTINCT FROM '5' then raise exception 'Location receipt mismatch'; end if;
 perform suspend_tag_private.group_command(actor,'replace_location',payload,cmd,null);
 select ptrreviewed into quantity from public.ph_master_inventory where unique_id=m.unique_id; if quantity<>'5' then raise exception 'Repeated allocation'; end if;
 tag.unique_id:='v23158-probe-empty';tag.concat:=tag.unique_id;insert into public.ph_soc_master select (tag).*;
 result:=suspend_tag_private.group_command(actor,'close',jsonb_build_object('sourceUid',tag.unique_id),gen_random_uuid(),null);
 if not exists(select 1 from public.ph_soc_master where unique_id=tag.unique_id and suspend is null and date_completed is not null and locationcode='0.00.111') then raise exception 'Unreviewed tag did not close'; end if;
END $p$;
DO $probe$ DECLARE row_id bigint; actual text; BEGIN
 INSERT INTO public.app_runtime_watchdog_events(fingerprint,app_version,event_type,severity,username,normalized_role,view_id,error_message,cluster_id,owning_skill,status,sample_payload)
 VALUES ('v23158-rollback-probe','2.3.1','OPERATIONAL_FAILURE','high','fixture','admin','request','UI_ERROR_BANNER_SHOWN:suspend-tag:55P03','Cluster 4','agdata-runtime-watchdog','resolved','{"observed_at":"test"}') RETURNING id INTO row_id;
 UPDATE public.app_runtime_watchdog_events SET status='resolved' WHERE id=row_id;
 SELECT status||':'||event_type INTO actual FROM public.app_runtime_watchdog_events WHERE id=row_id;
 IF actual IS DISTINCT FROM 'open:UI_ERROR_BANNER_SHOWN' THEN RAISE EXCEPTION 'Unexpected retention result %',actual; END IF;
 BEGIN PERFORM public.resolve_runtime_watchdog_events_v23158(array[row_id]); RAISE EXCEPTION 'Resolution lacked identity'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $probe$;
ROLLBACK;
