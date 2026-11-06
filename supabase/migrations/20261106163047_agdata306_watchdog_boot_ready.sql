BEGIN;
-- Existing authenticated app-api binds every event username to its verified actor.
DO $patch$
DECLARE source text := pg_get_functiondef('private.retain_watchdog_incident_v23158()'::regprocedure);
BEGIN
 IF position('agdata.watchdog_boot_ready_user' in source)=0 THEN
  IF position(E'BEGIN\n' in source)=0 OR position('  actor_name:=lower((private.current_active_profile()).username);' in source)=0 THEN RAISE EXCEPTION 'WATCHDOG_TRIGGER_ANCHOR_MISSING'; END IF;
  source:=replace(source,E'BEGIN\n',$guard$BEGIN
 -- v3.0.6: bounded recovery receipt; never persist a success as an incident.
 IF NEW.sub_module='preboot_auto_recovery' AND NEW.error_message='SHELL_READY' THEN
  PERFORM set_config('agdata.watchdog_boot_ready_user',NEW.username,true);
  UPDATE public.app_runtime_watchdog_events SET status='resolved',resolved_at=now(),resolved_in_version=NEW.app_version
   WHERE username=NEW.username AND status='open' AND sub_module='preboot_auto_recovery'
    AND error_message IN ('BOOT_TIMEOUT','STARTUP_ERROR','STARTUP_REJECTION');
  PERFORM set_config('agdata.watchdog_boot_ready_user','',true);
  RETURN NULL;
 END IF;
 IF NEW.error_message ~ '(^|:)VALIDATION_REQUIRED$' THEN RETURN NULL; END IF;
$guard$);
  source:=replace(source,'  actor_name:=lower((private.current_active_profile()).username);',$resolve$  IF OLD.username=current_setting('agdata.watchdog_boot_ready_user',true)
   AND OLD.sub_module='preboot_auto_recovery' AND OLD.error_message IN ('BOOT_TIMEOUT','STARTUP_ERROR','STARTUP_REJECTION') THEN
   NEW.resolved_at:=now(); NEW.last_seen_at:=OLD.last_seen_at; NEW.occurrence_count:=OLD.occurrence_count; RETURN NEW;
  END IF;
  actor_name:=lower((private.current_active_profile()).username);$resolve$);
  EXECUTE source;
 END IF;
END $patch$;
COMMIT;
