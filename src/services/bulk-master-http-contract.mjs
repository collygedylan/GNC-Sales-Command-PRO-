import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { legacyBulkSource, sourceRowsFromProductionShape } from './bulk-master-http-source.mjs';

export const HANDOVER_TRANSITION_KEY = 'kayla_knepp_to_nelly_aguilar_20261002';
const HANDOVER_SUCCESSOR_ID = '961b0a0f-11a6-4db5-b066-582f772ab8e7';
export const EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT = 51;

export async function readBulkMasterSchema(ctx) {
  const { state, query, queryValue } = ctx;
  state.shape = JSON.parse(readFileSync(new URL('../../tests/fixtures/bulk-master-import-shape.json', import.meta.url), 'utf8'));
  state.tableColumns = await query(`select column_name, data_type from information_schema.columns
    where table_schema='public' and table_name='ph_master_inventory' order by ordinal_position`);
  assert.equal(state.tableColumns.length, 233, 'the disposable schema includes all 233 production master columns');
  state.initial = legacyBulkSource(sourceRowsFromProductionShape({ shape: state.shape, columns: state.tableColumns }));
  state.masterImportFieldCount = Object.keys(state.initial.rows[0].values).length;
  assert.equal(state.masterImportFieldCount, 78,
    'legacy direct RPC receives the 79-field source payload minus only raw-only EXT_EQUIV_UNIT');
  state.sourceByteCount = Buffer.byteLength(JSON.stringify(state.initial.rows));
  const triggerState = await queryValue(`select count(*)::int as total,
      count(*) filter (where tgenabled <> 'D')::int as enabled,
      count(*) filter (where tgname='scheduled_handover_normalize_assignment')::int as handover,
      count(*) filter (where tgname='scheduled_handover_normalize_assignment' and tgenabled <> 'D')::int as handover_enabled
    from pg_trigger where tgrelid='public.ph_master_inventory'::regclass and not tgisinternal`);
  assert.equal(triggerState.total, EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT,
    'the HTTP benchmark contains every expected production master trigger');
  assert.equal(triggerState.enabled, EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT,
    'all production master triggers are enabled during the HTTP benchmark');
  assert.equal(triggerState.handover, 1, 'the scheduled assignment handover trigger is installed');
  assert.equal(triggerState.handover_enabled, 1, 'the scheduled assignment handover trigger is enabled');
  state.masterProductionTriggerCount = triggerState.total;

  state.fenceDatasetKeys = vm.runInContext("getDatasetImportFenceSources_('ph_master_inventory')", state.initial.context);
  // Snapshot the small revision catalog before the synthetic departing profile
  // is inserted: its production profile refresh trigger can touch dependencies
  // outside the master import fence, and cleanup must not poison later SQL checks.
  state.revisionSnapshot = await query(`select key, revision, state, changed_at::text as changed_at
    from public.app_dataset_revisions order by key`);
  state.revisionKeys = state.revisionSnapshot.map(row => row.key);
  state.seasonSettingsSnapshot = await query(`select key, value, updated_by, updated_at::text as updated_at
    from public.ph_app_settings where key='current_season_salesyear'`);
}

export async function prepareBulkHandoverIdentity(ctx) {
  const { state, queryValue, syntheticHandoverProfileId, db, syntheticHandoverEmail } = ctx;
  assert.equal((await queryValue('select marker from private.ci_schema_workspace_guard')).marker, 'canonical-baseline-replay');
  const { proconfig } = await queryValue(`select proconfig from pg_proc
    where oid='public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure`);
  assert.ok(proconfig.includes('statement_timeout=180s') && proconfig.includes('lock_timeout=60s'),
    'the bulk RPC keeps its installed statement and lock timeouts');
  const initialLiveCount = Number((await queryValue('select count(*)::int as count from public.ph_master_inventory')).count);
  assert.equal(initialLiveCount, 0, 'the disposable canonical HTTP workspace must begin without live inventory rows');
  state.handoverSnapshot = await queryValue(`select departing_profile_id::text as departing_profile_id,
      successor_profile_id::text as successor_profile_id, effective_at::text as effective_at
    from private.scheduled_account_handover_v1 where transition_key=$1`, [HANDOVER_TRANSITION_KEY]) || null;
  state.handoverStateCaptured = true;
  const existingSyntheticIdentity = await queryValue('select id::text as id from public.profiles where id=$1::uuid',
    [syntheticHandoverProfileId]);
  assert.equal(existingSyntheticIdentity, undefined, 'the synthetic departing profile UUID is unique');
  assert.equal(await queryValue(`select id from public.profiles where lower(btrim(username))='kayla_knepp'`), undefined,
    'the disposable canonical fixture has no departing account that could collide with the synthetic identity');
  const successor = await queryValue(`select id::text as id from public.profiles
    where id=$1::uuid and lower(btrim(username))='nelly_aguilar'`, [HANDOVER_SUCCESSOR_ID]);
  assert.equal(successor?.id, HANDOVER_SUCCESSOR_ID, 'the canonical synthetic successor identity is present');

  state.syntheticHandoverProfileCreated = true;
  const syntheticUser = await db.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1::uuid,'authenticated','authenticated',$2,'',clock_timestamp(),
      '{"provider":"email","providers":["email"],"fixture":true}'::jsonb,
      '{"fixture":"bulk-master-http-handover"}'::jsonb,clock_timestamp(),clock_timestamp())
    on conflict(id) do nothing`, [syntheticHandoverProfileId, syntheticHandoverEmail]);
  state.syntheticHandoverUserCreated = syntheticUser.rowCount === 1;
  await db.query(`insert into public.profiles(id,username,display_name,role,must_change_password)
    values($1::uuid,'kayla_knepp','Synthetic Bulk Handover Source','Admin',false)
    on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,
      role=excluded.role,must_change_password=excluded.must_change_password`, [syntheticHandoverProfileId]);

}

export async function scheduleBulkHandover(ctx) {
  const { state, db, syntheticHandoverProfileId, queryValue } = ctx;
  state.handoverScheduleTouched = true;
  if (state.handoverSnapshot) {
    await db.query(`update private.scheduled_account_handover_v1
      set departing_profile_id=$2::uuid,successor_profile_id=$3::uuid
      where transition_key=$1`, [HANDOVER_TRANSITION_KEY, syntheticHandoverProfileId, HANDOVER_SUCCESSOR_ID]);
  } else {
    await db.query(`insert into private.scheduled_account_handover_v1(
      transition_key,departing_profile_id,successor_profile_id,effective_at)
      values($1,$2::uuid,$3::uuid,'2026-10-03 04:00:00+00'::timestamptz)`,
    [HANDOVER_TRANSITION_KEY, syntheticHandoverProfileId, HANDOVER_SUCCESSOR_ID]);
  }
  const activeHandover = await queryValue(`select h.departing_profile_id::text as departing_profile_id,
      h.successor_profile_id::text as successor_profile_id,
      h.effective_at <= clock_timestamp() as is_due,
      lower(btrim(source.username)) as departing_username,
      lower(btrim(successor.username)) as successor_username
    from private.scheduled_account_handover_v1 h
    join public.profiles source on source.id=h.departing_profile_id
    join public.profiles successor on successor.id=h.successor_profile_id
    where h.transition_key=$1`, [HANDOVER_TRANSITION_KEY]);
  assert.deepEqual(activeHandover, {
    departing_profile_id: syntheticHandoverProfileId,
    successor_profile_id: HANDOVER_SUCCESSOR_ID,
    is_due: true,
    departing_username: 'kayla_knepp',
    successor_username: 'nelly_aguilar',
  }, 'the exact scheduled handover is due and active in the disposable benchmark');
}

export async function seedBulkMasterFixture(ctx) {
  const { state, withDisposableDbClaims, db } = ctx;
  // The season reconciliation is part of the canonical import contract and
  // reads this application setting; seed a complete, test-only value and
  // restore the exact original row in finally.
  await withDisposableDbClaims(() => db.query(`insert into public.ph_app_settings(key, value, updated_by, updated_at)
    values ('current_season_salesyear', '{"seasonCode":"F1","salesYear":"27"}'::jsonb, 'bulk_master_http_fixture', clock_timestamp())
    on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`));

  // Seed an old ERP row without creating a same-day app edit receipt.
  // Replica mode is transaction-local and ends before the HTTP fence opens.
  const obsolete = { ...state.initial.rows[0].values, unique_id: 'GNC_BULK_BENCH_OBSOLETE',
    itemcode: 'GNC_BULK_BENCH_OBSOLETE_ITEM', photos: [] };
  await withDisposableDbClaims(async () => {
    await db.query('set local session_replication_role=replica');
    await db.query('insert into public.ph_master_inventory select (jsonb_populate_record(null::public.ph_master_inventory,$1::jsonb)).*',
      [JSON.stringify(obsolete)]);
  });
}
