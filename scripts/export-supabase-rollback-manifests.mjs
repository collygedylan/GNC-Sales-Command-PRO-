#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const outputArgIndex = process.argv.indexOf('--output');
const outputDirectory = resolve(
  outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
    ? process.argv[outputArgIndex + 1]
    : 'artifacts/supabase-rollback'
);

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120_000,
  query_timeout: 120_000,
  application_name: 'agmetric_rollback_manifest'
});

const generatedFiles = [];

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeArtifact(name, content, recordCount = null) {
  const filePath = resolve(outputDirectory, name);
  const body = typeof content === 'string' ? content : stableJson(content);
  await writeFile(filePath, body, 'utf8');
  generatedFiles.push({
    name,
    bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex').toUpperCase(),
    ...(recordCount === null ? {} : { records: recordCount })
  });
}

await mkdir(outputDirectory, { recursive: true });
await client.connect();

try {
  // Supabase CLI database credentials authenticate as a short-lived login
  // role. The same role used by `supabase db dump` is allowed to assume the
  // database owner for read-only backup inspection.
  await client.query('set role postgres');
  await client.query('begin read only');

  const databaseSummary = await client.query(`
    select
      current_database() as database_name,
      current_setting('server_version') as postgres_version,
      pg_database_size(current_database())::bigint as database_bytes,
      now() as captured_at,
      (select count(*)::bigint from auth.users) as native_auth_users,
      (select count(*)::bigint from public.ph_app_users) as legacy_app_users,
      (select count(*)::bigint from storage.objects) as storage_objects,
      (select coalesce(sum((metadata->>'size')::bigint), 0)::bigint from storage.objects) as storage_metadata_bytes,
      (select count(*)::bigint from pg_policies where schemaname = 'public') as public_policy_count
  `);
  await writeArtifact('database-summary.json', databaseSummary.rows[0]);

  const relations = await client.query(`
    select
      n.nspname as schema_name,
      c.relname as relation_name,
      c.relkind,
      greatest(c.reltuples, 0)::bigint as estimated_rows,
      pg_relation_size(c.oid)::bigint as table_bytes,
      pg_indexes_size(c.oid)::bigint as index_bytes,
      pg_total_relation_size(c.oid)::bigint as total_bytes,
      coalesce(s.n_live_tup, 0)::bigint as live_tuples,
      coalesce(s.n_dead_tup, 0)::bigint as dead_tuples,
      s.last_analyze,
      s.last_autoanalyze,
      s.last_vacuum,
      s.last_autovacuum
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relid = c.oid
    where n.nspname in ('public', 'storage')
      and c.relkind in ('r', 'm', 'p')
    order by pg_total_relation_size(c.oid) desc, n.nspname, c.relname
  `);
  await writeArtifact('relation-sizes.json', relations.rows, relations.rowCount);

  const indexes = await client.query(`
    select
      schemaname as schema_name,
      relname as table_name,
      indexrelname as index_name,
      coalesce(idx_scan, 0)::bigint as index_scans,
      pg_relation_size(indexrelid)::bigint as index_bytes,
      pg_get_indexdef(indexrelid) as definition
    from pg_stat_user_indexes
    where schemaname in ('public', 'storage')
    order by pg_relation_size(indexrelid) desc, schemaname, relname, indexrelname
  `);
  await writeArtifact('index-sizes-and-usage.json', indexes.rows, indexes.rowCount);

  const policies = await client.query(`
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
    order by schemaname, tablename, policyname
  `);
  await writeArtifact('rls-policies.json', policies.rows, policies.rowCount);

  const storageBuckets = await client.query(`
    select to_jsonb(b) as bucket
    from storage.buckets b
    order by b.id
  `);
  await writeArtifact(
    'storage-buckets.ndjson',
    `${storageBuckets.rows.map(({ bucket }) => JSON.stringify(bucket)).join('\n')}\n`,
    storageBuckets.rowCount
  );

  const storageObjects = await client.query(`
    select to_jsonb(o) as object
    from storage.objects o
    order by o.bucket_id, o.name
  `);
  await writeArtifact(
    'storage-objects.ndjson',
    `${storageObjects.rows.map(({ object }) => JSON.stringify(object)).join('\n')}\n`,
    storageObjects.rowCount
  );

  const migrationHistory = await client.query(`
    select version, name, statements
    from supabase_migrations.schema_migrations
    order by version
  `);
  await writeArtifact('migration-history.json', migrationHistory.rows, migrationHistory.rowCount);

  await client.query('commit');
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  await client.end();
}

const manifest = {
  generatedAt: new Date().toISOString(),
  outputDirectory,
  files: generatedFiles
};
await writeArtifact('manifest.json', manifest, generatedFiles.length);

process.stdout.write(stableJson({
  ok: true,
  outputDirectory,
  files: generatedFiles.length,
  records: Object.fromEntries(generatedFiles.map((file) => [file.name, file.records ?? null]))
}));
