// Disposable-only full-size AV inventory read and row-identity Realtime rehearsal.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { inspectDisposableSupabaseWorkspace } from '../../scripts/disposable-supabase-container.mjs';
import { packageBin, runNode } from '../../scripts/tooling-process.mjs';
import { syntheticBulkMasterSnapshot } from './bulk_master_import_http.mjs';

const ROW_COUNT = 9539;
const errorText = value => String(value && (value.message || value.error || value.hint) || JSON.stringify(value));
const percentile = (samples, fraction) => [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.ceil(samples.length * fraction) - 1)];
const reportProgress = (stage, metrics = {}) => console.log(JSON.stringify({ kind: 'realtime-av-progress', stage, ...metrics }));

function statusEnvironment(output) {
  return Object.fromEntries(String(output).split(/\r?\n/)
    .map(line => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map(match => [match[1], match[2]]));
}

export function parseInventoryProjection(projectionName) {
  const source = readFileSync(new URL('../functions/_shared/inventory-projections.ts', import.meta.url), 'utf8');
  const match = source.match(new RegExp(`export const ${projectionName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
  if (!match) throw new Error(`REALTIME_AV_PROJECTION_NOT_FOUND:${projectionName}`);
  const columns = [...match[1].matchAll(/"([a-z][a-z0-9_]*)"/g)].map(item => item[1]);
  if (!columns.length || columns[0] !== 'unique_id' || new Set(columns).size !== columns.length) {
    throw new Error(`REALTIME_AV_PROJECTION_INVALID:${projectionName}`);
  }
  return columns;
}

function flattenPlan(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(Array.isArray(node.Plans) ? node.Plans.flatMap(flattenPlan) : [])];
}

export async function runRealtimeAvHydrationRegression(workspaceRoot, options = {}) {
  const cli = packageBin('supabase', 'supabase');
  const workspace = inspectDisposableSupabaseWorkspace({ workspaceRoot, cli });
  const values = statusEnvironment(runNode([cli, '--workdir', workspace.absolute, 'status', '--output', 'env'], { capture: true }));
  const api = new URL(values.API_URL || '');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) && api.protocol === 'http:'
    && values.SERVICE_ROLE_KEY && values.ANON_KEY,
  'Only a verified local disposable Supabase API with local credentials is accepted');
  assert.ok(basename(workspace.absolute).startsWith('gnc-db-workspace-'), 'canonical disposable workspace marker required');

  const db = new Client({ connectionString: workspace.dbUrl.href, connectionTimeoutMillis: 10000,
    application_name: 'isolated-realtime-av-hydration-ci' });
  await db.connect();
  const localOnlyFetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, api.origin, 'External HTTP requests are forbidden');
    return fetch(input, { ...init, redirect: 'error' });
  };
  const supabaseOptions = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localOnlyFetch } };
  const admin = createClient(api.origin, values.SERVICE_ROLE_KEY, supabaseOptions);
  const clients = [];
  const channels = [];
  const runIds = [];
  const requestIds = [];
  const seasonKeys = [];
  const activeRuns = new Set();
  let revisionKeys = [];
  let revisionSnapshot = [];
  let seasonSettingsSnapshot = [];
  let accessSnapshot = null;
  let snapshotsReady = false;
  let accessBoundaryApplied = false;
  let seasonSettingTouched = false;
  let appliedRealtimeBoundary;
  let managerId = '';
  let deniedId = '';
  let fixture = null;
  let failure = null;
  let cleanupFailure = null;
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const queryValue = async (sql, params = []) => (await query(sql, params))[0];
  const rpc = async (name, payload, key = values.SERVICE_ROLE_KEY, headers = {}, timeoutMs = 65000) => {
    const response = await localOnlyFetch(new URL(`/rest/v1/rpc/${name}`, api), {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  };
  const success = async (name, payload, headers = {}) => {
    const result = await rpc(name, payload, values.SERVICE_ROLE_KEY, headers);
    assert.equal(result.status, 200, `${name}: ${errorText(result.body)}`);
    return result.body;
  };
  const fenced = (name, payload, runId) => success(name, payload, {
    'x-gnc-import-run-id': runId, 'x-gnc-master-tuple-policy': 'raw-priority-hold-v1',
  });
  const setDisposableDbClaims = async () => {
    await db.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  };
  const withDbClaims = async callback => {
    await db.query('begin');
    try { await setDisposableDbClaims(); const result = await callback(); await db.query('commit'); return result; }
    catch (error) { await db.query('rollback').catch(() => {}); throw error; }
  };
  const explainAsServiceRole = async (sql, params = []) => withDbClaims(async () => {
    await db.query('set local role service_role');
    await db.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true),set_config('request.jwt.claim.role','service_role',true)");
    return db.query(`explain (analyze,buffers,format json) ${sql}`, params);
  });
  const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;
  const captureAccessBoundary = async () => ({
    tablePrivileges: await query(`select case acl.privilege_type when 'r' then 'SELECT' when 'a' then 'INSERT'
        when 'w' then 'UPDATE' when 'd' then 'DELETE' when 'D' then 'TRUNCATE' when 'x' then 'REFERENCES'
        when 't' then 'TRIGGER' when 'm' then 'MAINTAIN' else acl.privilege_type::text end as privilege_type,
        acl.is_grantable from pg_class as relation
      cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) as acl
      where relation.oid='public.ph_master_inventory'::regclass
        and acl.grantee=(select oid from pg_roles where rolname='authenticated')
      order by privilege_type,acl.is_grantable`),
    columnPrivileges: await query(`select attribute.attname as column_name,
        case acl.privilege_type when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
          when 'x' then 'REFERENCES' else acl.privilege_type::text end as privilege_type,
        acl.is_grantable from pg_attribute as attribute
      cross join lateral aclexplode(attribute.attacl) as acl
      where attribute.attrelid='public.ph_master_inventory'::regclass and attribute.attnum>0
        and not attribute.attisdropped and attribute.attacl is not null
        and acl.grantee=(select oid from pg_roles where rolname='authenticated')
      order by column_name,privilege_type,acl.is_grantable`),
    otherRoleTablePrivileges: await query(`select acl.grantee::text as grantee,acl.grantor::text as grantor,
        acl.privilege_type,acl.is_grantable from pg_class as relation
      cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) as acl
      where relation.oid='public.ph_master_inventory'::regclass
        and acl.grantee<>(select oid from pg_roles where rolname='authenticated')
      order by grantee,grantor,privilege_type,is_grantable`),
    otherRoleColumnPrivileges: await query(`select attribute.attname as column_name,acl.grantee::text as grantee,
        acl.grantor::text as grantor,acl.privilege_type,acl.is_grantable from pg_attribute as attribute
      cross join lateral aclexplode(attribute.attacl) as acl
      where attribute.attrelid='public.ph_master_inventory'::regclass and attribute.attnum>0
        and not attribute.attisdropped and attribute.attacl is not null
        and acl.grantee<>(select oid from pg_roles where rolname='authenticated')
      order by column_name,grantee,grantor,privilege_type,is_grantable`),
    salesPolicy: await query(`select policyname,permissive,to_json(roles) as roles,cmd,qual,with_check from pg_policies
      where schemaname='public' and tablename='ph_master_inventory' and policyname='sales_rep_inventory_read_v1'`),
  });
  const revokeAuthenticatedMasterAccess = async () => {
    await db.query('revoke all privileges on table public.ph_master_inventory from authenticated');
    const columns = await query(`select column_name from information_schema.columns
      where table_schema='public' and table_name='ph_master_inventory' order by ordinal_position`);
    if (columns.length) await db.query(`revoke all (${columns.map(({ column_name: column }) => quoteIdentifier(column)).join(',')})
      on table public.ph_master_inventory from authenticated`);
  };
  const applyRealtimeAccessBoundary = async () => withDbClaims(async () => {
    await db.query('drop policy if exists sales_rep_inventory_read_v1 on public.ph_master_inventory');
    await revokeAuthenticatedMasterAccess();
    await db.query('grant select (unique_id,itemcode,locationcode) on public.ph_master_inventory to authenticated');
  });
  const restoreAccessBoundary = async () => withDbClaims(async () => {
    await db.query('drop policy if exists sales_rep_inventory_read_v1 on public.ph_master_inventory');
    await revokeAuthenticatedMasterAccess();
    for (const { privilege_type: privilege, is_grantable } of accessSnapshot.tablePrivileges) {
      await db.query(`grant ${privilege} on table public.ph_master_inventory to authenticated${is_grantable ? ' with grant option' : ''}`);
    }
    const groupedColumns = new Map();
    for (const { column_name: column, privilege_type: privilege, is_grantable } of accessSnapshot.columnPrivileges) {
      const groupKey = `${privilege}\u0000${is_grantable}`;
      const group = groupedColumns.get(groupKey) || { privilege, is_grantable, columns: [] };
      group.columns.push(column);
      groupedColumns.set(groupKey, group);
    }
    for (const group of groupedColumns.values()) {
      const columns = group.columns.map(quoteIdentifier).join(',');
      await db.query(`grant ${group.privilege} (${columns}) on table public.ph_master_inventory to authenticated${group.is_grantable ? ' with grant option' : ''}`);
    }
    const [policy] = accessSnapshot.salesPolicy;
    if (policy) {
      const roles = (policy.roles || []).map(role => String(role).toLowerCase() === 'public' ? 'PUBLIC' : quoteIdentifier(role)).join(',');
      const using = policy.qual ? ` using (${policy.qual})` : '';
      const check = policy.with_check ? ` with check (${policy.with_check})` : '';
      await db.query(`create policy ${quoteIdentifier(policy.policyname)} on public.ph_master_inventory
        as ${policy.permissive.toLowerCase()} for ${policy.cmd.toLowerCase()} to ${roles}${using}${check}`);
    }
  });
  const verifyProductionRealtimeBoundary = async () => {
    const matrix = await queryValue(`select has_table_privilege('authenticated','public.ph_master_inventory','SELECT') as full_select,
      has_column_privilege('authenticated','public.ph_master_inventory','unique_id','SELECT') as unique_id_select,
      has_column_privilege('authenticated','public.ph_master_inventory','itemcode','SELECT') as itemcode_select,
      has_column_privilege('authenticated','public.ph_master_inventory','locationcode','SELECT') as locationcode_select,
      has_column_privilege('authenticated','public.ph_master_inventory','priority','SELECT') as priority_select,
      has_column_privilege('authenticated','public.ph_master_inventory','holdstopreason','SELECT') as holdstopreason_select,
      exists(select 1 from pg_policies where schemaname='public' and tablename='ph_master_inventory'
        and policyname='sales_rep_inventory_read_v1') as sales_policy`);
    assert.deepEqual(matrix, { full_select: false, unique_id_select: true, itemcode_select: true,
      locationcode_select: true, priority_select: false, holdstopreason_select: false, sales_policy: false },
    'applied ACL matches the verified production identifier-only boundary');
    const rowSecurity = await queryValue(`select relrowsecurity from pg_class where oid='public.ph_master_inventory'::regclass`);
    assert.equal(rowSecurity.relrowsecurity, true, 'production realtime fixture retains row-level security');
    const policies = await queryValue(`select coalesce(array_agg(policyname::text order by policyname::text),array[]::text[]) as names
      from pg_policies where schemaname='public' and tablename='ph_master_inventory'`);
    assert.deepEqual(policies.names, ['inventory_status_realtime_read_v1','scheduled_handover_active_session'],
      'production realtime fixture retains only the approved status and handover policies');
    return { matrix, policies: policies.names, rowSecurity: rowSecurity.relrowsecurity };
  };
  const restoreRevisions = async () => {
    const result = await db.query(`update public.app_dataset_revisions as current
      set revision=snapshot.revision,state=snapshot.state,changed_at=snapshot.changed_at
      from jsonb_to_recordset($1::jsonb) as snapshot(key text,revision bigint,state text,changed_at timestamptz)
      where current.key=snapshot.key returning current.key`, [JSON.stringify(revisionSnapshot)]);
    assert.equal(result.rowCount, revisionSnapshot.length, 'captured revision rows remain present for exact restoration');
    const originallyPresent = new Set(revisionSnapshot.map(row => row.key));
    const newlyCreated = revisionKeys.filter(key => !originallyPresent.has(key));
    if (newlyCreated.length) await db.query('delete from public.app_dataset_revisions where key=any($1::text[])', [newlyCreated]);
  };
  const actor = async (name, disabled = false) => {
    const email = `${randomUUID()}@example.invalid`;
    const password = `Disposable-only-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    const id = created.data.user.id;
    await db.query(`insert into public.profiles(id,username,display_name,role,disabled_at)
      values($1,$2,$3,'Manager',$4)`, [id, name, `Synthetic ${name}`, disabled ? new Date().toISOString() : null]);
    return { id, email, password };
  };
  const session = async account => {
    const client = createClient(api.origin, values.ANON_KEY, supabaseOptions);
    const signed = await client.auth.signInWithPassword({ email: account.email, password: account.password });
    assert.ifError(signed.error);
    clients.push(client);
    await client.realtime.setAuth(signed.data.session.access_token);
    return { client, token: signed.data.session.access_token };
  };
  const subscribeMasterIdentity = async (client, label, uniqueId) => {
    const events = [];
    let postgresReady = false;
    const channel = client.channel(`av-master-${label}-${randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ph_master_inventory', filter: `unique_id=eq.${uniqueId}` }, event => events.push(event))
      .on('system', {}, event => {
        if (event.extension === 'postgres_changes' && event.status === 'ok') postgresReady = true;
      });
    channels.push({ client, channel });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`REALTIME_SUBSCRIBE_TIMEOUT:${label}`)), 15000);
      channel.subscribe((state, error) => {
        if (state === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') { clearTimeout(timer); reject(error || new Error(state)); }
      });
    });
    const started = Date.now();
    while (!postgresReady && Date.now() - started < 15000) await delay(25);
    assert.ok(postgresReady, `Postgres change subscription ready for ${label}`);
    return events;
  };
  const inventoryRead = async (token, params) => {
    const start = performance.now();
    const headersStart = performance.now();
    const response = await localOnlyFetch(new URL('/functions/v1/app-api', api), {
      method: 'POST', headers: { apikey: values.ANON_KEY, Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json', 'x-request-id': randomUUID() },
      body: JSON.stringify({ action: 'inventory_read', operation: 'master_page', params }),
      signal: AbortSignal.timeout(30000),
    });
    const headersMs = performance.now() - headersStart;
    const text = await response.text();
    const totalMs = performance.now() - start;
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { throw new Error('REALTIME_AV_INVENTORY_READ_INVALID_JSON'); }
    return { status: response.status, body, headersMs, totalMs, bodyBytes: Buffer.byteLength(text) };
  };

  if (options.aclCheckOnly) {
    let snapshot;
    try {
      assert.equal((await queryValue('select marker from private.ci_schema_workspace_guard')).marker, 'canonical-baseline-replay',
        'verified canonical disposable baseline required');
      snapshot = await captureAccessBoundary();
      assert.ok(snapshot.tablePrivileges.some(item => item.privilege_type === 'SELECT'),
        'fixture has the nonproduction authenticated full-table grant to restore');
      assert.equal(snapshot.salesPolicy.length, 1, 'fixture has the nonproduction sales policy to restore');
      assert.ok(Array.isArray(snapshot.salesPolicy[0].roles), 'pg_policies.roles is returned as a role-name array');
      await applyRealtimeAccessBoundary();
      accessSnapshot = snapshot;
      accessBoundaryApplied = true;
      const boundary = await verifyProductionRealtimeBoundary();
      const activeAcl = await captureAccessBoundary();
      assert.deepEqual(activeAcl.otherRoleTablePrivileges, snapshot.otherRoleTablePrivileges,
        'applying the status fixture leaves every other role table grant unchanged');
      assert.deepEqual(activeAcl.otherRoleColumnPrivileges, snapshot.otherRoleColumnPrivileges,
        'applying the status fixture leaves every other role column grant unchanged');
      await restoreAccessBoundary();
      accessBoundaryApplied = false;
      assert.deepEqual(await captureAccessBoundary(), snapshot, 'direct table/column grants and sales policy restore exactly');
      console.log(JSON.stringify({ kind: 'realtime-av-acl-fixture-check', workspace: basename(workspace.absolute),
        salesPolicyRolesArray: true, directTableGrantCount: snapshot.tablePrivileges.length,
        directColumnGrantCount: snapshot.columnPrivileges.length, productionPrivacyMatrix: boundary.matrix,
        retainedRlsPolicies: boundary.policies, rowSecurity: boundary.rowSecurity,
        otherRoleAclUnchanged: true,
        restoredSnapshotEqual: true }));
    } finally {
      if (accessBoundaryApplied) {
        await restoreAccessBoundary();
        assert.deepEqual(await captureAccessBoundary(), snapshot, 'error cleanup restored direct ACL/policy snapshot');
      }
      await db.end();
    }
    return;
  }

  try {
    assert.equal((await queryValue('select marker from private.ci_schema_workspace_guard')).marker, 'canonical-baseline-replay',
      'verified canonical disposable baseline required');
    assert.equal(Number((await queryValue('select count(*)::int as count from public.ph_master_inventory')).count), 0,
      'fixture refuses to replace or mix with existing inventory rows');
    assert.equal((await query("select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ph_master_inventory'")).length, 1,
      'master table must be in the local Realtime publication');
    const databaseEnvironment = await queryValue(`select version() as version,
      current_setting('shared_buffers') as shared_buffers,current_setting('work_mem') as work_mem,
      current_setting('max_parallel_workers') as max_parallel_workers`);
    reportProgress('workspace-verified', { databaseVersion: databaseEnvironment.version.split(' ').slice(0, 2).join(' '), syntheticRows: ROW_COUNT });

    const shape = JSON.parse(readFileSync(new URL('../../tests/fixtures/bulk-master-import-shape.json', import.meta.url), 'utf8'));
    const tableColumns = await query(`select column_name,data_type from information_schema.columns
      where table_schema='public' and table_name='ph_master_inventory' order by ordinal_position`);
    fixture = syntheticBulkMasterSnapshot({ rowCount: ROW_COUNT, columns: tableColumns });
    assert.equal(fixture.rows.length, ROW_COUNT);
    assert.ok(fixture.rows.every(row => row.values.unique_id.startsWith('GNC_BULK_BENCH_')),
      'only deterministic synthetic importer identities are used');
    assert.ok(shape.length > 0, 'production aggregate shape fixture is present');
    const fenceKeys = vm.runInContext("getDatasetImportFenceSources_('ph_master_inventory')", fixture.context);
    revisionKeys = [...new Set([...fenceKeys, 'ph_itemcode_default_owners', 'ph_inventory_row_assignments', 'ph_app_settings', 'profiles'])];
    revisionSnapshot = await query(`select key,revision,state,changed_at::text as changed_at from public.app_dataset_revisions
      where key=any($1::text[]) order by key`, [revisionKeys]);
    seasonSettingsSnapshot = await query(`select key,value,updated_by,updated_at::text as updated_at from public.ph_app_settings
      where key='current_season_salesyear'`);
    accessSnapshot = await captureAccessBoundary();
    assert.ok(accessSnapshot.tablePrivileges.some(item => item.privilege_type === 'SELECT'),
      'canonical replay fixture includes the separately released broad authenticated inventory grant');
    assert.equal(accessSnapshot.salesPolicy.length, 1,
      'canonical replay fixture includes the separately released sales-only policy');
    assert.ok(revisionSnapshot.length > 0 && revisionSnapshot.every(row => row.state === 'ready'),
      'all import-fence revisions start ready');
    snapshotsReady = true;

    await withDbClaims(() => db.query(`insert into public.ph_app_settings(key,value,updated_by,updated_at)
      values('current_season_salesyear','{"seasonCode":"F1","salesYear":"27"}'::jsonb,'realtime_av_ci',clock_timestamp())
      on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at`));
    seasonSettingTouched = true;
    await applyRealtimeAccessBoundary();
    accessBoundaryApplied = true;
    appliedRealtimeBoundary = await verifyProductionRealtimeBoundary();
    const activeAccessSnapshot = await captureAccessBoundary();
    assert.deepEqual(activeAccessSnapshot.otherRoleTablePrivileges, accessSnapshot.otherRoleTablePrivileges,
      'realtime fixture leaves every other role table grant unchanged');
    assert.deepEqual(activeAccessSnapshot.otherRoleColumnPrivileges, accessSnapshot.otherRoleColumnPrivileges,
      'realtime fixture leaves every other role column grant unchanged');

    const runId = randomUUID(); runIds.push(runId); activeRuns.add(runId);
    const began = await success('begin_dataset_import_v1', { p_dataset_keys: fenceKeys, p_run_id: runId, p_canonical_keys: ['ph_master_inventory'] });
    assert.equal(began.ok, true, 'full master dataset fence starts');
    const requestId = randomUUID(); requestIds.push(requestId);
    const rpcStart = performance.now();
    const imported = await success('bulk_import_master_snapshot_v1', {
      p_run_id: runId, p_request_id: requestId, p_rows: fixture.rows, p_source_digest: fixture.sourceDigest,
    });
    const importMs = performance.now() - rpcStart;
    assert.equal(imported.sourceRows, ROW_COUNT);
    assert.equal(imported.inserted, ROW_COUNT);
    assert.equal(imported.deleted, 0);
    reportProgress('import-complete', { rows: ROW_COUNT, elapsedMs: Number(importMs.toFixed(2)) });

    const safeRevision = new Date().toISOString();
    const importRevision = `master_inventory:${safeRevision}`;
    const baseKey = `season-sales-${createHash('sha256').update(`master_inventory|${safeRevision}`).digest('base64url').slice(0, 80)}`;
    seasonKeys.push(baseKey);
    const dry = await fenced('reconcile_season_sales_office_v1', {
      p_itemcodes: null, p_dry_run: true, p_import_revision: importRevision, p_idempotency_key: null,
    }, runId);
    const seasonPlan = { ...dry, status: dry.status === 'dry_run' && dry.ok ? 'completed' : dry.status };
    const seasonScope = vm.runInContext('validateSeasonSalesReconciliationPlan_', fixture.context)(seasonPlan, 'SEASON_SALES_RECONCILIATION');
    const batchSize = 25;
    for (let offset = 0, batchIndex = 0; offset < seasonScope.itemcodes.length; offset += batchSize, batchIndex += 1) {
      const batch = seasonScope.itemcodes.slice(offset, offset + batchSize);
      await fenced('heartbeat_dataset_import_v1', { p_run_id: runId }, runId);
      const key = vm.runInContext('getSeasonSalesBatchIdempotencyKey_', fixture.context)(baseKey, batchIndex, batch);
      seasonKeys.push(key);
      const result = await fenced('reconcile_season_sales_office_v1', {
        p_itemcodes: batch, p_dry_run: false, p_import_revision: importRevision, p_idempotency_key: key,
      }, runId);
      assert.equal(result.ok, true); assert.equal(result.status, 'completed');
    }
    const evalReconciliation = await fenced('reconcile_eval_report2_work_v1', {
      p_import_revision: new Date().toISOString(), p_dry_run: false, p_limit: 5000,
    }, runId);
    assert.equal(evalReconciliation.status, 'completed');
    let expectedAssignments = null, previousAssignments = -1, resets = 0;
    for (let call = 0; call < 500; call += 1) {
      await fenced('heartbeat_dataset_import_v1', { p_run_id: runId }, runId);
      const result = await fenced('reconcile_inventory_row_assignments_batch_v1', {
        p_import_run_id: runId, p_batch_size: 100,
      }, runId);
      assert.equal(result.ok, true);
      if (result.status === 'reset') { assert.equal(result.processed, 0); assert.ok(++resets <= 1); expectedAssignments = result.total; previousAssignments = 0; continue; }
      if (expectedAssignments === null) expectedAssignments = result.total;
      assert.equal(result.total, expectedAssignments);
      if (result.status === 'completed') { assert.equal(result.processed, result.total); break; }
      assert.equal(result.status, 'in_progress'); assert.ok(result.processed > previousAssignments && result.processed < result.total);
      previousAssignments = result.processed;
      if (call === 499) throw new Error('REALTIME_AV_ASSIGNMENT_RECONCILIATION_LIMIT');
    }
    const finished = await success('finish_dataset_import_v1', { p_run_id: runId });
    assert.equal(finished.ok, true); activeRuns.delete(runId);

    const manager = await actor(`ci_rt_manager_${randomUUID().replaceAll('-', '').slice(0, 12)}`);
    managerId = manager.id;
    const denied = await actor(`ci_rt_denied_${randomUUID().replaceAll('-', '').slice(0, 12)}`, true);
    deniedId = denied.id;
    const phone = await session(manager), tablet = await session(manager), deniedSession = await session(denied);
    const deniedRead = await inventoryRead(deniedSession.token, { dataset: 'master', projection: 'browse', limit: 500, offset: 0 });
    assert.equal(deniedRead.status, 401, 'disabled profile is rejected during native-session resolution before inventory authorization');
    const pageParams = { dataset: 'master', projection: 'browse', limit: 500, offset: 0 };
    const firstPage = await inventoryRead(phone.token, pageParams);
    reportProgress('http-first-page', { status: firstPage.status, elapsedMs: Number(firstPage.totalMs.toFixed(2)),
      headersMs: Number(firstPage.headersMs.toFixed(2)), rows: firstPage.body?.data?.rows?.length ?? null,
      responseBytes: firstPage.bodyBytes });
    assert.equal(firstPage.status, 200, `manager master_page: ${errorText(firstPage.body)}`);
    assert.equal(firstPage.body?.ok, true); assert.equal(firstPage.body.data.rows.length, 500);
    assert.equal(Number(firstPage.body.data.total), ROW_COUNT);
    assert.equal(firstPage.body.data.rows[0].unique_id, fixture.rows[0].values.unique_id,
      'native AV uses the master browse projection and stable unique_id ordering');
    const warmPageSamples = [];
    for (let i = 0; i < 7; i += 1) {
      const result = await inventoryRead(phone.token, pageParams);
      assert.equal(result.status, 200); assert.equal(result.body.data.rows.length, 500);
      warmPageSamples.push(result.totalMs);
    }
    reportProgress('http-page-samples', { warmP50Ms: Number(percentile(warmPageSamples, 0.5).toFixed(2)),
      warmP95Ms: Number(percentile(warmPageSamples, 0.95).toFixed(2)), samples: warmPageSamples.length });
    assert.ok(firstPage.totalMs < 1000, `first interactive master page API request exceeded 1 s (${firstPage.totalMs.toFixed(2)} ms)`);

    const pairRow = fixture.rows[0].values;
    const pairParams = { dataset: 'lookup', projection: 'full', itemCode: pairRow.itemcode,
      locationCode: pairRow.locationcode, limit: 500, offset: 0 };
    const pairResult = await inventoryRead(phone.token, pairParams);
    reportProgress('http-pair-lookup', { status: pairResult.status, elapsedMs: Number(pairResult.totalMs.toFixed(2)),
      rows: pairResult.body?.data?.rows?.length ?? null });
    assert.equal(pairResult.status, 200, `manager pair lookup: ${errorText(pairResult.body)}`);
    assert.equal(pairResult.body.data.projection, 'full', 'pair status refresh uses the native full projection');
    assert.equal(pairResult.body.data.limit, 500, 'pair status refresh uses the native 500-row page size');
    assert.ok(pairResult.body.data.rows.length <= 500, 'pair status refresh respects server pagination');
    assert.ok(pairResult.body.data.rows.some(row => row.unique_id === pairRow.unique_id), 'pair lookup returns its requested synthetic row');
    const pairSamples = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await inventoryRead(phone.token, pairParams);
      assert.equal(result.status, 200); pairSamples.push(result.totalMs);
    }
    const browseFields = parseInventoryProjection('INVENTORY_MASTER_BROWSE_COLUMNS');
    const fullFields = parseInventoryProjection('INVENTORY_MASTER_FULL_COLUMNS');
    const browseSql = `select ${browseFields.map(field => `"${field}"`).join(',')} from public.ph_master_inventory
      order by unique_id asc limit 500 offset 0`;
    const explainStart = performance.now();
    const explain = await explainAsServiceRole(browseSql);
    const explainElapsedMs = performance.now() - explainStart;
    const plan = explain.rows[0]['QUERY PLAN'][0];
    const planNodes = flattenPlan(plan.Plan);
    const planSummary = { planningMs: plan['Planning Time'], executionMs: plan['Execution Time'], nodeType: plan.Plan['Node Type'],
      indexNames: [...new Set(planNodes.map(node => node['Index Name']).filter(Boolean))], sharedHitBlocks: plan.Plan['Shared Hit Blocks'] || 0,
      sharedReadBlocks: plan.Plan['Shared Read Blocks'] || 0, returnedRows: plan.Plan['Actual Rows'] };
    assert.equal(planSummary.returnedRows, 500);
    reportProgress('sql-browse-plan', { role: 'service_role', executionMs: planSummary.executionMs,
      planningMs: planSummary.planningMs, rows: planSummary.returnedRows, indexNames: planSummary.indexNames,
      sharedReadBlocks: planSummary.sharedReadBlocks, sharedHitBlocks: planSummary.sharedHitBlocks, explain: plan });
    assert.ok(planSummary.executionMs < 100, `browse query plan exceeded 100 ms (${planSummary.executionMs.toFixed(2)} ms)`);
    const countPlanResult = await explainAsServiceRole('select count(*) from public.ph_master_inventory');
    const countPlan = countPlanResult.rows[0]['QUERY PLAN'][0];
    reportProgress('sql-count-plan', { role: 'service_role', executionMs: countPlan['Execution Time'],
      sharedReadBlocks: countPlan.Plan['Shared Read Blocks'] || 0, sharedHitBlocks: countPlan.Plan['Shared Hit Blocks'] || 0,
      explain: countPlan });
    assert.ok(countPlan['Execution Time'] < 100,
      `exact-count query plan exceeded 100 ms (${countPlan['Execution Time'].toFixed(2)} ms)`);
    const pairPlanResult = await explainAsServiceRole(`select ${fullFields.map(field => `"${field}"`).join(',')}
      from public.ph_master_inventory where itemcode=$1 and locationcode=$2
      order by unique_id asc limit 500 offset 0`, [pairRow.itemcode, pairRow.locationcode]);
    const pairPlan = pairPlanResult.rows[0]['QUERY PLAN'][0];
    reportProgress('sql-pair-plan', { role: 'service_role', executionMs: pairPlan['Execution Time'],
      nodeType: pairPlan.Plan['Node Type'], indexNames: [...new Set(flattenPlan(pairPlan.Plan).map(node => node['Index Name']).filter(Boolean))],
      explain: pairPlan });
    assert.ok(pairPlan['Execution Time'] < 100,
      `pair lookup SQL exceeded 100 ms (${pairPlan['Execution Time'].toFixed(2)} ms)`);
    const revisionPlanResult = await explainAsServiceRole(`select revision,state from public.app_dataset_revisions
      where key=$1 limit 1`, ['ph_master_inventory']);
    const revisionPlan = revisionPlanResult.rows[0]['QUERY PLAN'][0];
    reportProgress('sql-revision-plan', { role: 'service_role', executionMs: revisionPlan['Execution Time'],
      nodeType: revisionPlan.Plan['Node Type'], explain: revisionPlan });
    assert.ok(revisionPlan['Execution Time'] < 100,
      `dataset readiness SQL exceeded 100 ms (${revisionPlan['Execution Time'].toFixed(2)} ms)`);

    const authenticatedRlsRows = async profileId => withDbClaims(async () => {
      await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.role','authenticated',true)",
        [JSON.stringify({ role: 'authenticated', sub: profileId })]);
      const result = await db.query('select unique_id from public.ph_master_inventory where unique_id=$1', [pairRow.unique_id]);
      return result.rows.length;
    });
    assert.equal(await authenticatedRlsRows(manager.id), 1, 'active manager sees the row through authenticated column grants and RLS');
    assert.equal(await authenticatedRlsRows(denied.id), 0, 'inactive account is filtered by RLS without service-role bypass');

    const rowId = fixture.rows[0].values.unique_id;
    const phoneEvents = await subscribeMasterIdentity(phone.client, 'phone', rowId);
    const tabletEvents = await subscribeMasterIdentity(tablet.client, 'tablet', rowId);
    const deniedEvents = await subscribeMasterIdentity(deniedSession.client, 'denied', rowId);
    const updatedLocation = `${String(pairRow.locationcode).slice(0, 20)}-RT`;
    const realtimeRunId = randomUUID(); runIds.push(realtimeRunId); activeRuns.add(realtimeRunId);
    const realtimeBegin = await success('begin_dataset_import_v1', {
      p_dataset_keys: fenceKeys, p_run_id: realtimeRunId, p_canonical_keys: ['ph_master_inventory'],
    });
    assert.equal(realtimeBegin.ok, true, 'a real import fence authorizes the synthetic identity update');
    const updateStart = performance.now();
    const updated = await localOnlyFetch(new URL(`/rest/v1/ph_master_inventory?unique_id=eq.${encodeURIComponent(rowId)}`, api), {
      method: 'PATCH', headers: { apikey: values.SERVICE_ROLE_KEY, Authorization: `Bearer ${values.SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=representation', 'x-gnc-import-run-id': realtimeRunId,
        'x-gnc-master-tuple-policy': 'raw-priority-hold-v1' },
      body: JSON.stringify({ locationcode: updatedLocation }), signal: AbortSignal.timeout(15000),
    });
    const updatedText = await updated.text();
    assert.equal(updated.status, 200, `service importer update: ${updatedText.slice(0, 300)}`);
    assert.equal(JSON.parse(updatedText).length, 1);
    const eventDeadline = Date.now() + 10000;
    while ((!phoneEvents.length || !tabletEvents.length) && Date.now() < eventDeadline) await delay(20);
    const propagationMs = performance.now() - updateStart;
    const allowedRealtimeFields = ['itemcode', 'locationcode', 'unique_id'];
    const authorizedRealtimeKeysets = [phoneEvents[0], tabletEvents[0]].map(event => ({
      old: Object.keys(event?.old || {}).sort(),
      new: Object.keys(event?.new || {}).sort(),
    }));
    reportProgress('realtime-propagation', { elapsedMs: Number(propagationMs.toFixed(2)),
      authorizedSessionEventCounts: [phoneEvents.length, tabletEvents.length], deniedSessionEventCount: deniedEvents.length,
      authorizedPayloadKeysets: authorizedRealtimeKeysets });
    assert.equal(phoneEvents.length, 1, 'first authorized session receives the identity update once');
    assert.equal(tabletEvents.length, 1, 'second authorized session receives the identity update once');
    assert.equal(deniedEvents.length, 0, 'inactive account receives no identity event');
    for (const [index, event] of [phoneEvents[0], tabletEvents[0]].entries()) {
      assert.deepEqual(authorizedRealtimeKeysets[index].new, allowedRealtimeFields,
        `authorized session ${index + 1} receives only the three realtime invalidation fields`);
      assert.ok(authorizedRealtimeKeysets[index].old.every(field => allowedRealtimeFields.includes(field)),
      `authorized session ${index + 1} old payload contains only allowed identity fields`);
      assert.equal(event.new.unique_id, rowId);
      if (Object.hasOwn(event.old || {}, 'unique_id')) {
        assert.equal(event.old.unique_id, rowId, `authorized session ${index + 1} old payload identifies the updated row`);
      }
    }
    assert.equal(phoneEvents[0].new.locationcode, updatedLocation);
    const closedRealtimeRun = await success('fail_dataset_import_v1', { p_run_id: realtimeRunId }, { 'x-gnc-import-run-id': realtimeRunId });
    assert.equal(closedRealtimeRun.ok, true); activeRuns.delete(realtimeRunId);

    console.log(JSON.stringify({
      kind: 'realtime-av-hydration-disposable', workspace: basename(workspace.absolute),
      environment: { postgresVersion: databaseEnvironment.version, sharedBuffers: databaseEnvironment.shared_buffers,
        workMem: databaseEnvironment.work_mem, maxParallelWorkers: databaseEnvironment.max_parallel_workers },
      rowCount: ROW_COUNT, browseProjectionColumns: browseFields.length, sourceShapeFixture: 'tests/fixtures/bulk-master-import-shape.json',
      measurementLimits: { osCacheCleared: false, databaseSharedBuffersCleared: false, appRuntimeColdStartControlled: false,
        note: 'first request means the first app-api request for this operation after fixture setup; OS/shared-buffer cache is uncontrolled; HTTP includes auth and local network latency' },
      importSetupMs: Math.round(importMs),
      firstPage: { firstRequestMs: Number(firstPage.totalMs.toFixed(2)), headersMs: Number(firstPage.headersMs.toFixed(2)),
        warmP50Ms: Number(percentile(warmPageSamples, 0.5).toFixed(2)), warmP95Ms: Number(percentile(warmPageSamples, 0.95).toFixed(2)),
        rows: firstPage.body.data.rows.length, total: firstPage.body.data.total, bodyBytes: firstPage.bodyBytes },
      pairLookup: { firstRequestMs: Number(pairResult.totalMs.toFixed(2)), warmP50Ms: Number(percentile(pairSamples, 0.5).toFixed(2)),
        warmP95Ms: Number(percentile(pairSamples, 0.95).toFixed(2)), returnedRows: pairResult.body.data.rows.length,
        includesAuthAndLocalNetwork: true },
      queryPlan: { measuredOperation: 'exact app-api master_page and pair lookup SELECT shapes; SET LOCAL ROLE service_role with service_role JWT claims',
        databaseRole: 'service_role',
        explainRoundTripMs: Number(explainElapsedMs.toFixed(2)), ...planSummary,
        explainPlans: { browse: plan, count: countPlan, fullPair: pairPlan, datasetRevision: revisionPlan },
        pairLookupExecutionMs: pairPlan['Execution Time'], pairLookupNodeType: pairPlan.Plan['Node Type'],
        pairLookupIndexNames: [...new Set(flattenPlan(pairPlan.Plan).map(node => node['Index Name']).filter(Boolean))],
        datasetReadinessExecutionMs: revisionPlan['Execution Time'], datasetReadinessNodeType: revisionPlan.Plan['Node Type'],
        exactCountExecutionMs: countPlan['Execution Time'], exactCountSharedHitBlocks: countPlan.Plan['Shared Hit Blocks'] || 0,
        exactCountSharedReadBlocks: countPlan.Plan['Shared Read Blocks'] || 0 },
      realtime: { eventCountPerAuthorizedSession: [phoneEvents.length, tabletEvents.length], deniedEventCount: deniedEvents.length,
        idOnlyUpdateToBothSessionsMs: Number(propagationMs.toFixed(2)), payloadKeysets: authorizedRealtimeKeysets },
      authorization: { managerInventoryReadStatus: firstPage.status, inactiveProfileInventoryReadStatus: deniedRead.status,
        managerRlsRows: 1, inactiveProfileRlsRows: 0 },
      realtimeAclFixture: { source: 'local canonical rollback fixture snapshot',
        applied: 'authenticated SELECT on unique_id,itemcode,locationcode; removed nonproduction sales_rep_inventory_read_v1 policy',
        capturedAuthenticatedTableAndColumnAcl: true, capturedNonproductionSalesPolicy: true,
        rowSecurity: appliedRealtimeBoundary.rowSecurity, retainedPolicies: appliedRealtimeBoundary.policies,
        otherRoleAclUnchanged: true, cleanupRestoreAndExactComparisonExpected: accessBoundaryApplied },
    }));
  } catch (error) {
    failure = error;
  } finally {
    try {
      reportProgress('cleanup-start', { activeRunCount: activeRuns.size, syntheticFixturePresent: Boolean(fixture) });
      for (const { client, channel } of channels) await client.removeChannel(channel).catch(() => {});
      for (const client of clients) await client.auth.signOut({ scope: 'local' }).catch(() => {});
      for (const id of [managerId, deniedId].filter(Boolean)) {
        const deleted = await admin.auth.admin.deleteUser(id);
        assert.ifError(deleted.error);
        await db.query('delete from public.profiles where id=$1', [id]);
      }
      for (const runId of [...activeRuns]) {
        const failed = await success('fail_dataset_import_v1', { p_run_id: runId }, { 'x-gnc-import-run-id': runId });
        assert.equal(failed.ok, true);
      }
      if (runIds.length || revisionSnapshot.length) {
        await db.query('begin'); await setDisposableDbClaims();
        if (runIds.length) {
          await db.query('delete from app_sync_private.import_leases where run_id=any($1::uuid[])', [runIds]);
          await db.query('delete from app_sync_private.import_runs where id=any($1::uuid[])', [runIds]);
        }
        if (revisionSnapshot.length) await restoreRevisions();
        await db.query('commit');
      }
      if (snapshotsReady) {
        await db.query('begin'); await setDisposableDbClaims();
        if (runIds.length) {
          await db.query('delete from app_sync_private.ph_master_inventory_import_lineage_seen where run_id=any($1::uuid[])', [runIds]);
          await db.query('delete from app_sync_private.ph_master_inventory_item6_alias_seen_v7 where run_id=any($1::uuid[])', [runIds]);
          await db.query('delete from app_sync_private.ph_master_bulk_import_context_v1 where run_id=any($1::uuid[])', [runIds]);
        }
        if (requestIds.length) await db.query('delete from app_sync_private.ph_master_bulk_import_receipts_v1 where request_id=any($1::uuid[])', [requestIds]);
        if (seasonKeys.length) await db.query('delete from private.season_sales_office_idempotency where idempotency_key=any($1::text[])', [seasonKeys]);
        await db.query(`delete from public.ph_season_sales_office_events event using public.ph_season_sales_office_state state
        where event.state_id=state.id and state.itemcode_normalized like 'GNC_BULK_BENCH_%'`);
        await db.query("delete from public.ph_sales_office where unique_id like 'GNC_BULK_BENCH_%'");
        await db.query("delete from public.ph_season_sales_office_state where itemcode_normalized like 'GNC_BULK_BENCH_%'");
        await db.query("delete from private.ph_inventory_row_assignment_audit where master_unique_id like 'GNC_BULK_BENCH_%'");
        await db.query("delete from public.ph_inventory_row_assignments where master_unique_id like 'GNC_BULK_BENCH_%'");
        await db.query("delete from app_sync_private.ph_master_bulk_import_source_v1 where canonical_unique_id like 'GNC_BULK_BENCH_%'");
        await db.query("delete from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id like 'GNC_BULK_BENCH_%'");
        await db.query("delete from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id like 'GNC_BULK_BENCH_%'");
        await db.query("delete from app_sync_private.ph_master_inventory_item6_source_v7 where canonical_unique_id like 'GNC_BULK_BENCH_%'");
        await db.query("delete from app_sync_private.ph_master_inventory_item6_aliases_v7 where canonical_unique_id like 'GNC_BULK_BENCH_%' or imported_unique_id like 'GNC_BULK_BENCH_%'");
        await db.query("delete from public.ph_master_inventory where unique_id like 'GNC_BULK_BENCH_%'");
        if (seasonSettingTouched) await db.query("delete from public.ph_app_settings where key='current_season_salesyear'");
        if (seasonSettingTouched && seasonSettingsSnapshot.length) await db.query(`insert into public.ph_app_settings(key,value,updated_by,updated_at)
        select key,value,updated_by,updated_at from jsonb_to_recordset($1::jsonb) as s(key text,value jsonb,updated_by text,updated_at timestamptz)`,
        [JSON.stringify(seasonSettingsSnapshot)]);
        if (revisionSnapshot.length) await restoreRevisions();
        await db.query('commit');

        if (accessBoundaryApplied) {
          await restoreAccessBoundary();
          accessBoundaryApplied = false;
          assert.deepEqual(await captureAccessBoundary(), accessSnapshot,
            'authenticated master table/column privileges and sales policy restored exactly');
        }

        assert.equal(Number((await queryValue("select count(*)::int as count from public.ph_master_inventory where unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
        'synthetic master rows removed');
        assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
        'synthetic source baselines removed');
        assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.import_runs where id=any($1::uuid[])', [runIds])).count), 0,
        'owned import runs removed');
        assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.import_leases where run_id=any($1::uuid[])', [runIds])).count), 0,
        'owned import leases removed');
        assert.deepEqual(await query(`select key,revision,state,changed_at::text as changed_at from public.app_dataset_revisions
        where key=any($1::text[]) order by key`, [revisionKeys]), revisionSnapshot, 'source revisions restored exactly');
        assert.deepEqual(await query(`select key,value,updated_by,updated_at::text as updated_at from public.ph_app_settings
          where key='current_season_salesyear'`), seasonSettingsSnapshot, 'season setting restored exactly');
      }
      reportProgress('cleanup-complete', { syntheticFixtureRemoved: snapshotsReady,
        accessAclRestored: !accessBoundaryApplied });
    } catch (error) { cleanupFailure = error; await db.query('rollback').catch(() => {}); }
    await db.end().catch(error => { cleanupFailure ||= error; });
  }
  if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], 'REALTIME_AV_HYDRATION_AND_CLEANUP_FAILED');
  if (failure) throw failure;
  if (cleanupFailure) throw new Error(`REALTIME_AV_HYDRATION_CLEANUP_FAILED:${cleanupFailure.message}`, { cause: cleanupFailure });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (![3, 4].includes(process.argv.length) || (process.argv[3] && process.argv[3] !== '--acl-check')) {
    throw new Error('Usage: node supabase/ci/realtime_av_hydration.mjs <verified-canonical-workspace> [--acl-check]');
  }
  await runRealtimeAvHydrationRegression(process.argv[2], { aclCheckOnly: process.argv[3] === '--acl-check' });
}
