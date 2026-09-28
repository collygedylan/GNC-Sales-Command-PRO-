import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const migrationName = '20260928145055_item_low_stock_targets.sql';

export function validateDatabaseTarget(connectionString, supabaseUrl) {
  if (!connectionString) throw new Error('LOW_STOCK_SUPABASE_DB_URL_MISSING');
  let database, api;
  try { database = new URL(connectionString); api = new URL(supabaseUrl); }
  catch { throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID'); }
  const match = api.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (api.protocol !== 'https:' || !match || !['postgres:', 'postgresql:'].includes(database.protocol)) {
    throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID');
  }
  const user = decodeURIComponent(database.username);
  const direct = database.hostname === `db.${match[1]}.supabase.co` && user === 'postgres';
  const pooler = database.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${match[1]}`;
  if ((!direct && !pooler) || !database.password || database.pathname !== '/postgres') throw new Error('LOW_STOCK_DATABASE_TARGET_MISMATCH');
  // pg merges query parameters over authority fields. Do not allow host/user
  // query overrides to redirect this narrowly scoped production operation.
  const allowed = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'application_name']);
  for (const key of database.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID');
  }
  if (!database.searchParams.has('sslmode')) database.searchParams.set('sslmode', 'require');
  if (!['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode'))) {
    throw new Error('LOW_STOCK_DATABASE_TLS_REQUIRED');
  }
  return database.toString();
}

export function migrationBody(source) {
  if (!/^begin;\s/i.test(source) || !/\scommit;\s*$/i.test(source)) throw new Error('LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED');
  return source.replace(/^begin;\s*/i, '').replace(/\scommit;\s*$/i, '');
}

export async function applyItemLowStockMigration({ client, source }) {
  const version = migrationName.split('_')[0];
  const name = migrationName.slice(version.length + 1, -4);
  const body = migrationBody(source);
  await client.query('begin');
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('gnc-item-low-stock-schema-v1'))");
    const prior = await client.query('select name, statements from supabase_migrations.schema_migrations where version = $1', [version]);
    if (prior.rows.length) {
      if (prior.rows[0].name !== name || prior.rows[0].statements?.join('\n') !== body) throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
    } else {
      await client.query(body);
      await client.query('insert into supabase_migrations.schema_migrations(version,name,statements) values ($1,$2,$3)', [version,name,[body]]);
    }
    const result = await client.query("select to_regprocedure('public.get_eval_item_low_stock_targets_v1(text[],text,integer)') is not null as installed");
    if (result.rows[0]?.installed !== true) throw new Error('LOW_STOCK_DATABASE_CONTRACT_MISSING');
    await client.query('commit');
    return { status: prior.rows.length ? 'already_applied' : 'applied' };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  // This command runs only after the existing cloud release-proof verifier.
  // Recheck current main immediately before opening the database connection.
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main'
      || !['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) throw new Error('LOW_STOCK_CLOUD_MAIN_REQUIRED');
  const repository = process.env.GITHUB_REPOSITORY || '', sha = process.env.GITHUB_SHA || '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha) || !process.env.GH_TOKEN) throw new Error('LOW_STOCK_RELEASE_IDENTITY_REQUIRED');
  const response = await fetch(`https://api.github.com/repos/${repository}/git/ref/heads/main`, {
    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000)
  });
  if (!response.ok || (await response.json()).object?.sha !== sha) throw new Error('LOW_STOCK_CURRENT_MAIN_REQUIRED');
  const connectionString = validateDatabaseTarget(process.env.SUPABASE_DB_URL, process.env.SUPABASE_URL);
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000, statement_timeout: 120000 });
  try {
    await client.connect();
    const source = fs.readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8');
    console.log(`Item low-stock schema: ${(await applyItemLowStockMigration({ client, source })).status}.`);
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // Never include a connection string or raw database error in CI output.
    console.error(/^LOW_STOCK_[A-Z_]+$/.test(error.message) ? error.message : 'LOW_STOCK_SCHEMA_APPLY_FAILED');
    process.exitCode = 1;
  });
}
