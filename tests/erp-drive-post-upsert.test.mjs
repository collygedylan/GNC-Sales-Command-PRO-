import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {assertDrivePostUpsert} from './helpers/erp-drive-post-upsert.mjs';

test('Invariant 659: compiled DRIVE reconciles only changed Item6 notes and preserves the raw publication path', assertDrivePostUpsert);

const migration = readFileSync(new URL('../supabase/migrations/20261113190000_drive_publication_lineage_work.sql', import.meta.url), 'utf8');
const catchupGuard = migration.match(/do \$catchup_outbox\$[\s\S]+?\$catchup_outbox\$;/)?.[0];

function assertCatchupGuard(source) {
  assert.match(source, /current_setting\('app\.skip_catchup_outbox',true\) is not distinct from 'on'\s+and session_user = 'postgres' and coalesce\(auth\.role\(\),''\) = 'service_role'/);
  assert.match(source, /assignment_anchor\|\|E'\\n      and not \('\|\|guard/);
  assert.match(source, /'  if '\|\|guard\|\|E' then return null; end if;\\n'\|\|wake_anchor/);
  assert.match(source, /md5\(assignment_definition\).*\s+or md5\(wake_definition\)/);
}

const catchupFixture = `
set local session authorization postgres;
create temp table catchup_source as select * from public.ph_master_inventory with no data;
create temp table catchup_wakes (source text);
insert into catchup_source(unique_id,itemcode,genusname,commonname,locationcode)
values ('catchup-guard-fixture','CATCHUP-GUARD-FIXTURE','Fixture','Catch-up guard','C.01.001');
do $mock$
declare
  discovery text := pg_get_functiondef('private.sync_new_unassigned_warehouse_itemcodes_v1(uuid)'::regprocedure);
  wake text := pg_get_functiondef('private.wake_request_delivery_worker_now(text)'::regprocedure);
begin
  execute replace(discovery,'from public.ph_master_inventory','from pg_temp.catchup_source');
  execute left(wake,strpos(wake,'  select decrypted_secret into worker_url')-1)
    || '  insert into pg_temp.catchup_wakes values(p_source); return 4242; end; $function$';
end
$mock$;
select set_config('request.jwt.claim.role','service_role',true);
select public.begin_dataset_import_v1(array['ph_master_inventory'],'d3084000-0000-4000-8000-000000000001',array['ph_master_inventory']);
do $verify$
declare result jsonb;
begin
  perform set_config('app.skip_catchup_outbox','on',true);
  result:=private.sync_new_unassigned_warehouse_itemcodes_v1('d3084000-0000-4000-8000-000000000001');
  if (result->>'push_events',result->>'warehouse_rows',result->>'new_itemcodes') is distinct from ('0','1','1')
    or exists(select 1 from pg_temp.catchup_wakes) then raise exception 'catch-up guard failed: %',result; end if;
  update pg_temp.catchup_source set itemcode='CATCHUP-GUARD-NORMAL';
  perform set_config('app.skip_catchup_outbox','off',true);
  result:=private.sync_new_unassigned_warehouse_itemcodes_v1('d3084000-0000-4000-8000-000000000001');
  if result->>'push_events' is distinct from '1' or not exists(select 1 from pg_temp.catchup_wakes where source='outbox_insert') then
    raise exception 'normal outbox or wake suppressed: %',result;
  end if;
  perform set_config('app.skip_catchup_outbox','on',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if private.wake_request_delivery_worker_now('wrong-claim') is distinct from 4242::bigint then
    raise exception 'non-service claim suppressed a wake';
  end if;
end
$verify$;
reset session authorization;
set local session authorization service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $untrusted$
begin
  if private.wake_request_delivery_worker_now('wrong-session') is distinct from 4242::bigint then
    raise exception 'non-operator session suppressed a wake';
  end if;
end
$untrusted$;
reset session authorization;
select 'DRIVE catch-up guard verified';`;

function runCatchupFixture(container, database) {
  assert.match(container, /^supabase_db_gncdb[a-z0-9]{8,32}$/);
  assert.match(database, /^(?:erp\d+_[a-z0-9_]+|codex_erp_prune_guard)$/);
  const image = execFileSync('docker', ['inspect', '--format', '{{.Config.Image}}', container], { encoding: 'utf8', timeout: 5000 });
  assert.match(image.trim(), /^public\.ecr\.aws\/supabase\/postgres:17\.[0-9.]+$/);
  const output = execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', database, '-Atq'],
    { encoding: 'utf8', input: `begin;\n${catchupGuard}\n${catchupFixture}\nrollback;`, timeout: 15000 });
  assert.equal(output.trim().split('\n').at(-1), 'DRIVE catch-up guard verified');
}

test('Invariant 660: only the dedicated DRIVE catch-up transaction suppresses enqueue and wake', () => {
  assertCatchupGuard(catchupGuard);
  for (const marker of ["session_user = 'postgres'", "'service_role'", 'and not', 'then return null']) {
    assert.throws(() => assertCatchupGuard(catchupGuard.replace(marker, 'omitted_guard')));
  }
  const { GNC_DRIVE_CANDIDATE_SQL_CONTAINER: container, GNC_DRIVE_CANDIDATE_SQL_DATABASE: database } = process.env;
  if (container && database) runCatchupFixture(container, database);
});
