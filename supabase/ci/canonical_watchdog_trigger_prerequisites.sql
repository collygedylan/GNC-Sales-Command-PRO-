begin;
-- Reconstruct the pre-boot-readiness trigger before running the historical patch.
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_WATCHDOG_TRIGGER_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
CREATE OR REPLACE FUNCTION private.retain_watchdog_incident_v23158()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE kind text := split_part(NEW.error_message,':',1); actor_name text;
BEGIN
 IF NEW.event_type='OPERATIONAL_FAILURE' AND kind IN ('UI_ERROR_BANNER_SHOWN','UI_CONTROL_BAR_EMPTY','UI_GEOMETRY_ANOMALY','QUEUE_BADGE_MISMATCH','CLIENT_VERSION_DRIFT','RPC_FAILURE') AND NEW.error_message ~ '^[A-Z_]+:[a-z-]{1,24}:[A-Z0-9_]{1,40}$' THEN
  NEW.event_type:=kind; NEW.sample_payload:=NEW.sample_payload||jsonb_build_object('event_type',kind);
 END IF;

 IF split_part(NEW.error_message,':',3) IN ('42501','HTTP_403','SAVE_FAILED','OPERATION_FAILED','RESTRICTED')
 AND (NEW.dataset_revisions_snapshot #>> '{drive_command,revision}') ~ '^drive-[A-Za-z0-9_-]{8,175}$'
 AND EXISTS (SELECT 1 FROM public.profiles p JOIN private.drive_evidence_idempotency r ON r.profile_id=p.id
   WHERE lower(p.username)=lower(NEW.username) AND p.disabled_at IS NULL AND NOT p.must_change_password
   AND (p.locked_until IS NULL OR p.locked_until<=now())
   AND regexp_replace(lower(p.role),'[^a-z]','','g') IN ('superadmin','admin','administrator','manager','qcsupervisor','qc','eval','evaluator')
   AND r.idempotency_key='location-v3-'||md5(NEW.dataset_revisions_snapshot #>> '{drive_command,revision}')
   AND r.outcome_code='SAVED' AND r.response_payload @> '{"ok":true,"canonicalConfirmed":true}') THEN
   NEW.status:='resolved'; NEW.resolved_at:=CASE WHEN TG_OP='UPDATE' AND OLD.status='resolved' THEN coalesce(OLD.resolved_at,now()) ELSE now() END;
   NEW.resolved_in_version:=NEW.app_version; RETURN NEW;
 END IF;
 -- v2.3.165 operational telemetry disposition. Do not acknowledge a denied command.
 IF NEW.error_message IN ('UI_GEOMETRY_ANOMALY:navigation:FOOTER_OFFSCREEN','QUEUE_BADGE_MISMATCH:queue:BADGE_EXCESS','RPC_FAILURE:rpc:TIMEOUT','UI_ERROR_BANNER_SHOWN:detail:NETWORK','RPC_FAILURE:request:HTTP_409','UI_ERROR_BANNER_SHOWN:suspend-tag:55P03','UI_ERROR_BANNER_SHOWN:detail:OPERATION_FAILED','UI_ERROR_BANNER_SHOWN:reclass:OPERATION_FAILED','RPC_FAILURE:rpc:ERROR') AND NOT (
   split_part(NEW.error_message,':',3) IN ('SAVE_FAILED','OPERATION_FAILED','ERROR') AND EXISTS (
     SELECT 1 FROM public.app_runtime_watchdog_events sec
     WHERE sec.username=NEW.username AND sec.view_id=NEW.view_id AND sec.app_version=NEW.app_version
       AND split_part(sec.error_message,':',3) IN ('42501','HTTP_401','HTTP_403','RESTRICTED')
       AND sec.last_seen_at BETWEEN NEW.last_seen_at-interval '2 minutes' AND NEW.last_seen_at+interval '2 minutes'
   )
 ) THEN
   NEW.status:='resolved';
   IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'resolved' OR NEW.sample_payload->>'observed_at' IS DISTINCT FROM OLD.sample_payload->>'observed_at' THEN
      NEW.resolved_at:=now(); NEW.resolved_in_version:='2.3.165';
   ELSE
      NEW.resolved_at:=OLD.resolved_at; NEW.resolved_in_version:=OLD.resolved_in_version;
   END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='INSERT' OR NEW.sample_payload->>'observed_at' IS DISTINCT FROM OLD.sample_payload->>'observed_at' THEN
  NEW.status:='open'; NEW.resolved_at:=NULL; NEW.resolved_in_version:=NULL;
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='resolved' THEN
  actor_name:=lower((private.current_active_profile()).username);
  IF coalesce(actor_name,'') NOT IN ('dylan_collyge','megan_kelly','jd_jones') AND OLD.last_seen_at >= now()-interval '7 days' THEN RETURN NULL; END IF;
  NEW.resolved_at:=now(); NEW.resolved_in_version:=coalesce(case when actor_name in ('dylan_collyge','megan_kelly','jd_jones') then nullif(current_setting('agdata.watchdog_review_version',true),'') end,(select value->>'app_version' from public.ph_app_settings where key='app_version'),OLD.app_version);
  NEW.last_seen_at:=OLD.last_seen_at; NEW.occurrence_count:=OLD.occurrence_count;
 ELSIF NEW.status=OLD.status THEN
  NEW.resolved_at:=OLD.resolved_at; NEW.resolved_in_version:=OLD.resolved_in_version;
 END IF;
 RETURN NEW;
END $function$;
revoke all on function private.retain_watchdog_incident_v23158() from public, anon, authenticated, service_role;
drop trigger zz_resolve_superseded_client_event on public.app_runtime_watchdog_events;
create trigger zz_retain_watchdog_incident before insert or update on public.app_runtime_watchdog_events
  for each row execute function private.retain_watchdog_incident_v23158();
commit;
