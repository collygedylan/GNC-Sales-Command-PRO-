-- Isolated migration replay fixture only. Run after scheduled_handover_fixture.sql
-- and before the Nelly baseline repair migration; never apply to production.
create table private.ci_nelly_baseline_before_repair as
select profile_id,permission_key,allowed,access_scope,captured_at
from private.app_access_legacy_baseline
where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7';

do $snapshot_contract$
declare snapshot_rows integer;
begin
  select count(*) into snapshot_rows from private.ci_nelly_baseline_before_repair;
  if snapshot_rows <> 2 then
    raise exception 'CI_NELLY_BASELINE_SNAPSHOT_UNEXPECTED';
  end if;
end;
$snapshot_contract$;
