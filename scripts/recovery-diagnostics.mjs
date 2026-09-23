import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const code = value => /^[A-Z0-9_]{2,64}$/.test(String(value || '')) ? String(value) : 'UNAVAILABLE';
export const migrationDigest = versions => createHash('sha256').update(JSON.stringify([...versions].sort())).digest('hex');

// No mutation/recovery mode. Failed checks never hide independent results.
export async function collectRecoveryDiagnostics({ fetchImpl = fetch, db, appOrigin = 'https://agmetricapp.com',
  deploymentId = '', supabaseUrl = '', serviceKey = '', now = () => Date.now() } = {}) {
  const report = { schemaVersion: 'gnc-recovery-diagnostics-v1', checkedAt: new Date(now()).toISOString(), checks: {} };
  async function check(name, work) {
    const start = now();
    try { report.checks[name] = { ok: true, ...await work(), durationMs: now() - start }; }
    catch (error) { report.checks[name] = { ok: false, code: code(error.code), durationMs: now() - start }; }
  }
  async function json(url, options = {}) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Object.assign(new Error(), { code: `HTTP_${response.status}` });
    return response.json();
  }
  const jobs = [check('frontend', async () => {
    const fingerprint = await json(`${appOrigin.replace(/\/$/, '')}/deployment.json?diagnostic=${now()}`);
    if (fingerprint.schemaVersion !== 'gnc-deployment-fingerprint-v1' || !/^[a-f0-9]{40}$/.test(fingerprint.commit)
      || !/^V\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(fingerprint.release)) throw new Error();
    return { commit: fingerprint.commit, release: fingerprint.release };
  }), check('appsScript', async () => {
    if (!deploymentId) throw Object.assign(new Error(), { code: 'CONFIGURATION_MISSING' });
    const health = await json(`https://script.google.com/macros/s/${encodeURIComponent(deploymentId)}/exec`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'deployment_health' })
    });
    if (health.ok !== true || !/^[a-f0-9]{40}$/.test(health.deployedCommit)) throw new Error();
    const imports = health.importDiagnostics;
    return { commit: health.deployedCommit, policy: code(String(health.lifecycleRecipientPolicyVersion || '').toUpperCase().replaceAll('-', '_')),
      importStatus: imports ? { active: imports.active === true, stale: imports.stale === true,
        failureCountLastSevenDays: Math.max(0, Math.min(8, Number(imports.failureCountLastSevenDays) || 0)) } : null };
  }), check('database', async () => {
    if (!db) throw Object.assign(new Error(), { code: 'CONFIGURATION_MISSING' });
    await db.query('BEGIN READ ONLY');
    try {
      await db.query("SET LOCAL statement_timeout = '8000ms'");
      const datasets = (await db.query('SELECT key, state, changed_at FROM public.app_dataset_revisions ORDER BY key LIMIT 1000')).rows;
      const imports = (await db.query('SELECT state, created_at, finished_at, expires_at FROM app_sync_private.import_runs ORDER BY created_at DESC LIMIT 10')).rows;
      const versions = (await db.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r => r.version);
      const lastSuccess = (await db.query("SELECT max(finished_at) AS at FROM app_sync_private.import_runs WHERE state = 'completed'")).rows[0]?.at;
      const ready = datasets.filter(r => r.state === 'ready').length;
      return { ok: datasets.length > 0 && datasets.length < 1000 && ready === datasets.length,
        datasetCount: datasets.length, readyCount: ready,
        affected: datasets.filter(r => r.state !== 'ready').map(r => ({ key: r.key, state: r.state, changedAt: r.changed_at })),
        imports: imports.map(r => ({ state: r.state, startedAt: r.created_at, finishedAt: r.finished_at,
          stalled: r.state === 'active' && Date.parse(r.expires_at) < now() })),
        lastSuccessfulImport: lastSuccess || null, migrationCount: versions.length, migrationDigest: migrationDigest(versions) };
    } finally { await db.query('ROLLBACK'); }
  })];
  for (const [name, table, key] of [['Drive', 'ph_master_inventory', 'unique_id'], ['Requests', 'ph_active_request', 'id'], ['AV', 'ph_cav_import', 'unique_id']]) {
    jobs.push(check(`api${name}`, async () => {
      if (!supabaseUrl || !serviceKey) throw Object.assign(new Error(), { code: 'CONFIGURATION_MISSING' });
      const rows = await json(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?select=${key}&limit=1`, {
        headers: { apikey: serviceKey, ...(!serviceKey.startsWith('sb_') ? { authorization: `Bearer ${serviceKey}` } : {}) }
      });
      if (!Array.isArray(rows)) throw new Error();
      return { sampledRows: rows.length, scope: 'service_availability_not_user_authorization' };
    }));
  }
  await Promise.all(jobs);
  report.ok = Object.values(report.checks).every(c => c.ok);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let db, client;
  try {
    if (process.env.GNC_SUPABASE_DB_URL) {
      const { Client } = await import('pg');
      const url = new URL(process.env.GNC_SUPABASE_DB_URL);
      // Supabase's public CA, downloaded from the URL used by its dashboard.
      // This is per-connection trust, not a change to the machine's trust store.
      const caFile = process.env.GNC_SUPABASE_CA_FILE || new URL('./certs/supabase-prod-ca-2021.crt', import.meta.url);
      if (caFile) {
        url.searchParams.delete('sslmode'); url.searchParams.delete('sslrootcert');
      }
      client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000,
        ...(caFile ? { ssl: { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true } } : {}) });
      try { await client.connect(); db = client; }
      catch (error) { const connectionCode = code(error.code); db = { query: async () => { throw Object.assign(new Error(), { code: connectionCode }); } }; }
    }
    const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const result = await collectRecoveryDiagnostics({ db,
      appOrigin: process.env.PRODUCTION_APP_ORIGIN || 'https://agmetricapp.com',
      deploymentId: process.env.APPS_SCRIPT_DEPLOYMENT_ID || source.match(/script.google.com\/macros\/s\/([^/]+)\/exec/)?.[1],
      supabaseUrl: process.env.PRODUCTION_SUPABASE_URL || source.match(/const SUPABASE_URL = "([^"]+)"/)?.[1],
      serviceKey: process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY });
    if (process.argv.includes('--save')) {
      mkdirSync('.gnc-local', { recursive: true });
      writeFileSync('.gnc-local/recovery-diagnostics.json', JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ ok: result.ok, checkedAt: result.checkedAt,
        checks: Object.fromEntries(Object.entries(result.checks).map(([name, c]) => [name, { ok: c.ok, code: c.code, durationMs: c.durationMs }])),
        report: '.gnc-local/recovery-diagnostics.json' }));
    } else console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error(JSON.stringify({ ok: false, code: code(error.code) })); process.exitCode = 1; }
  finally { if (client) await client.end().catch(() => {}); }
}
