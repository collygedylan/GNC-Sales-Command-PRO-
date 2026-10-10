// @test-runtime: canonical-http
// Full-size publication through PostgREST; never accepts remote credentials.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { Client } from 'pg';
import { inspectDisposableSupabaseWorkspace } from '../../scripts/disposable-supabase-container.mjs';
import { packageBin, runNode } from '../../scripts/tooling-process.mjs';

export function syntheticMappingSnapshot() {
  const headers = [...JSON.parse(readFileSync(new URL('../../tests/fixtures/customer-rep-map-headers.json', import.meta.url), 'utf8')), 'FUTURE_SOURCE_FIELD'];
  assert.equal(headers.length, 122);
  const data = Array.from({ length: 14645 }, (_, index) => {
    const molly = index < 149;
    const customer = molly ? index % 119 : index;
    const fields = {
      CUSTOMERIDENTITYID: String(customer + 1).padStart(7, '0'),
      CUSTOMERNAME: customer < 2 ? 'Shared display name ®' : `Synthetic customer ${customer} ™`,
      CONSIGNEEID: String(index + 1).padStart(8, '0'), CONSIGNEENAME: `Synthetic consignee ${index} 植物`,
      SALESREPID: molly ? 'S02' : '0007', SALESREPNAME: molly ? 'Dixon, Molly' : 'Unrelated Rep',
      CUSTOMERSTATUS: molly || index % 3 ? 'A' : 'I', CONSIGNEESTATUS: molly || index % 5 ? 'A' : 'I',
      FUTURE_SOURCE_FIELD: 'Unknown source column: Café ® ™ 植物 0000123',
    };
    return headers.map(header => fields[header] ?? '');
  });
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    LockService: { getScriptLock: () => ({ hasLock: () => false }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(createHash('sha256').update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'), getUuid: randomUUID,
    },
    MimeType: { CSV: 'text/csv', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
  });
  new vm.Script(readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8'), { filename: 'Code.gs' }).runInContext(ctx);
  ctx.SpreadsheetApp = { openById: () => ({ getSheets: () => [{ getDataRange: () => ({
    getDisplayValues: () => [['Synthetic report preamble'], headers, ...data],
  }) }] }) };
  ctx.__file = { getMimeType: () => 'application/vnd.google-apps.spreadsheet', getId: () => 'synthetic', getName: () => 'synthetic-14645.gsheet' };
  ctx.__data = vm.runInContext("extractDataFromFile(__file, 'synthetic', { headerMatcher: isCustomerRepMapCompleteHeaderRow_, displayValues: true, preserveHeaderRowIndex: true })", ctx);
  const snapshot = vm.runInContext("buildCustomerRepMapSnapshot_(__data, '2026-10-10T12:00:00Z', 'synthetic-14645.xlsx')", ctx);
  const rows = JSON.parse(JSON.stringify(snapshot.rows));
  assert.equal(rows.length, 14645);
  assert.ok(rows.every(row => Object.keys(row.raw_data).length === 122));
  return rows;
}

export async function runMappingHttpRegression(workspaceRoot) {
  const cli = packageBin('supabase', 'supabase');
  const workspace = inspectDisposableSupabaseWorkspace({ workspaceRoot, cli });
  const values = Object.fromEntries(runNode([cli, '--workdir', workspace.absolute, 'status', '--output', 'env'], { capture: true })
    .split(/\r?\n/).map(line => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map(match => [match[1], match[2]]));
  const api = new URL(values.API_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) && api.protocol === 'http:' && values.SERVICE_ROLE_KEY,
    'Only the verified disposable stack HTTP endpoint is allowed');
  const db = new Client({ connectionString: workspace.dbUrl.href, connectionTimeoutMillis: 10000 });
  await db.connect();
  const rpc = async (name, payload, key = values.SERVICE_ROLE_KEY) => {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, api), {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(65000),
    });
    return { status: response.status, body: await response.json() };
  };
  const success = async (name, payload) => {
    const result = await rpc(name, payload);
    assert.equal(result.status, 200, `${name}: ${JSON.stringify(result.body)}`);
    return result.body;
  };
  const queryValue = async sql => (await db.query(sql)).rows[0];
  try {
    assert.equal((await queryValue('select marker from private.ci_schema_workspace_guard')).marker, 'canonical-baseline-replay');
    const source = syntheticMappingSnapshot();
    const runId = randomUUID();
    const fn = 'public.finalize_customer_rep_mapping_import_v1(uuid)';
    assert.ok((await queryValue(`select proconfig from pg_proc where oid='${fn}'::regprocedure`)).proconfig.includes('statement_timeout=55s'));
    // Fixtures only: production defaults are neither changed nor broadened.
    await db.query(`alter role authenticator set statement_timeout='8s'; alter role service_role reset statement_timeout;
      create function public.ci_mapping_http_settings() returns text language sql as $$select current_setting('statement_timeout')$$;
      revoke all on function public.ci_mapping_http_settings() from public,anon,authenticated;
      grant execute on function public.ci_mapping_http_settings() to service_role;
      notify pgrst,'reload config'; notify pgrst,'reload schema';`);
    let defaultReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await rpc('ci_mapping_http_settings', {});
      if (result.status === 200 && result.body === '8s') { defaultReady = true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(defaultReady, 'HTTP service_role inherits the production-style 8s default');
    await db.query(`insert into public.ph_customer_consignee_sales_reps
      (unique_id,customeridentityid,customername,consigneeid,consigneename,salesrepid,salesrepname,customerstatus,consigneestatus)
      select row->>'unique_id',row->>'customeridentityid','Manual correction',row->>'consigneeid','Old consignee','OLD','Old rep','A','A'
      from jsonb_array_elements($1::jsonb) row`, [JSON.stringify(source.slice(0, 14474).map(row => ({
      unique_id: row.unique_id, customeridentityid: row.customeridentityid, consigneeid: row.consigneeid,
    })))]);
    await db.query(`insert into public.ph_customer_consignee_sales_reps
      (unique_id,customeridentityid,customername,consigneeid,consigneename,salesrepid,salesrepname,customerstatus,consigneestatus)
      values ('http-obsolete','OLD','Obsolete customer','OLD','Obsolete consignee','OLD','Old rep','A','A')`);
    const before = await queryValue("select revision::text,state from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'");
    await success('begin_customer_rep_mapping_import_v1', { p_run_id: runId, p_source_file_id: 'synthetic-14645.xlsx',
      p_source_modified_at: '2026-10-10T12:00:00Z', p_source_hash: 'a'.repeat(64), p_expected_rows: source.length });
    assert.equal((await rpc('finalize_customer_rep_mapping_import_v1', { p_run_id: runId })).body.message, 'CUSTOMER_REP_IMPORT_INCOMPLETE');
    for (let offset = 0; offset < source.length; offset += 300) {
      const payload = source.slice(offset, offset + 300).map(({ raw_data, ...row }) => ({
        unique_id: row.unique_id, source_row_number: row.source_row_number, raw_data, row,
      }));
      const result = await success('stage_customer_rep_mapping_rows_v1', { p_run_id: runId, p_rows: payload });
      assert.equal(result.stagedRows, Math.min(offset + 300, source.length));
    }
    assert.ok([401, 403].includes((await rpc('finalize_customer_rep_mapping_import_v1', { p_run_id: runId }, values.ANON_KEY)).status));
    // Force an operation past 8s, independently of hardware speed. A statement
    // trigger sleeps once per publication, never once per fixture row.
    await db.query(`create function private.ci_mapping_publication_delay() returns trigger language plpgsql as
      $$begin perform pg_sleep(9); return null; end$$;
      create trigger ci_mapping_publication_delay after insert on public.ph_customer_consignee_sales_reps
      for each statement execute function private.ci_mapping_publication_delay();
      alter function ${fn} reset statement_timeout; notify pgrst,'reload schema';`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const rejected = await rpc('finalize_customer_rep_mapping_import_v1', { p_run_id: runId });
    assert.equal(rejected.body.code, '57014', 'Inherited 8s timeout reproduces the production rollback');
    assert.equal((await queryValue('select count(*)::int as count from public.ph_customer_consignee_sales_reps')).count, 14475);
    assert.deepEqual(await queryValue("select revision::text,state from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'"), before);
    await db.query(`alter function ${fn} set statement_timeout='55s'; notify pgrst,'reload schema';`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const start = performance.now();
    const publishing = success('finalize_customer_rep_mapping_import_v1', { p_run_id: runId });
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal((await queryValue('select count(*)::int as count from public.ph_customer_consignee_sales_reps')).count, 14475,
      'Concurrent readers retain the prior complete snapshot until commit');
    const published = await publishing;
    assert.equal(published.rowCount, 14645);
    assert.ok(BigInt(published.revision) > BigInt(before.revision));
    const counts = await queryValue(`select count(*)::int as total,
      count(*) filter(where salesrepid='S02' and customerstatus='A' and consigneestatus='A')::int as relationships,
      count(distinct customeridentityid) filter(where salesrepid='S02' and customerstatus='A' and consigneestatus='A')::int as customers,
      count(*) filter(where unique_id='http-obsolete')::int as obsolete,
      count(*) filter(where (select count(*) from jsonb_object_keys(raw_data))=122)::int as wide
      from public.ph_customer_consignee_sales_reps`);
    assert.deepEqual(counts, { total: 14645, relationships: 149, customers: 119, obsolete: 0, wide: 14645 });
    assert.equal((await db.query('select customeridentityid,customername from public.ph_customer_consignee_sales_reps where unique_id=$1', [source[0].unique_id])).rows[0].customername, 'Shared display name ®');
    const ready = await queryValue("select revision::text,state from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'");
    assert.equal(ready.state, 'ready');
    const retry = await success('finalize_customer_rep_mapping_import_v1', { p_run_id: runId });
    assert.equal(retry.idempotent, true);
    assert.equal(retry.revision, published.revision);
    assert.deepEqual(await queryValue("select revision::text,state from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'"), ready);
    console.log(`[mapping-http] 14645 rows x 122 columns; rollback, atomic visibility, 149/119 mappings and idempotency passed; publication ${Math.round(performance.now() - start)}ms including 9s delay.`);
  } finally {
    // The caller destroys this proven disposable stack even on failure.
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node supabase/ci/customer_rep_mapping_http.mjs <verified-workspace>');
  await runMappingHttpRegression(process.argv[2]);
}
