#!/usr/bin/env node

import pg from 'pg';

const { Client } = pg;
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const cutoffDate = String(process.env.DRIVE_AROUND_CUTOFF_DATE || '2025-08-16');
const batchSize = Math.min(250_000, Math.max(1, Number(process.env.DRIVE_AROUND_BATCH_SIZE || 100_000)));
const skipCopy = /^(1|true|yes)$/i.test(String(process.env.DRIVE_AROUND_SKIP_COPY || ''));

if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 180_000,
  query_timeout: 180_000,
  application_name: 'agmetric_drive_around_compaction'
});

await client.connect();
try {
  await client.query('set role postgres');
  let cursor = '';
  let copied = 0;
  let batches = 0;

  if (!skipCopy) {
    for (;;) {
      const result = await client.query(
        'select copied_rows, next_cursor from private.copy_drive_around_compact_batch_v2($1::date, $2::text, $3::integer)',
        [cutoffDate, cursor, batchSize]
      );
      const row = result.rows[0] || {};
      const count = Number(row.copied_rows || 0);
      const nextCursor = String(row.next_cursor || '');
      if (!count || !nextCursor) break;
      copied += count;
      batches += 1;
      cursor = nextCursor;
      process.stdout.write(`${JSON.stringify({ phase: 'copy', batches, copied, cursor })}\n`);
    }
  }

  await client.query('begin isolation level repeatable read read only');

  async function verifyDirection(sourceTable, targetTable, phase) {
    let verifyCursor = '';
    let rowCount = 0;
    let rowsHash = 0n;
    let verifyBatches = 0;
    const fileIds = new Set();

    for (;;) {
      const result = await client.query(`
        with source_batch as materialized (
          select unique_id, file_id, row_hash
          from public.${sourceTable}
          where report_date >= $1::date
            and unique_id > $2::text
          order by unique_id
          limit $3::integer
        )
        select
          count(*)::bigint row_count,
          max(b.unique_id) next_cursor,
          coalesce(sum(hashtextextended(coalesce(b.row_hash, b.unique_id), 0)::numeric), 0)::text rows_hash,
          coalesce(array_agg(distinct b.file_id) filter (where b.file_id is not null), '{}') file_ids,
          count(*) filter (
            where t.unique_id is null or t.row_hash is distinct from b.row_hash
          )::bigint mismatch_count
        from source_batch b
        left join public.${targetTable} t on t.unique_id = b.unique_id
      `, [cutoffDate, verifyCursor, batchSize]);
      const row = result.rows[0] || {};
      const count = Number(row.row_count || 0);
      const nextCursor = String(row.next_cursor || '');
      const mismatchCount = Number(row.mismatch_count || 0);
      if (mismatchCount) {
        throw new Error(`${phase} parity failed with ${mismatchCount} mismatched rows after ${verifyCursor}`);
      }
      if (!count || !nextCursor) break;
      rowCount += count;
      rowsHash += BigInt(String(row.rows_hash || '0'));
      for (const fileId of row.file_ids || []) fileIds.add(String(fileId));
      verifyCursor = nextCursor;
      verifyBatches += 1;
      process.stdout.write(`${JSON.stringify({ phase, verifyBatches, rowCount, cursor: verifyCursor })}\n`);
    }

    return { rowCount, fileCount: fileIds.size, rowsHash: rowsHash.toString(), verifyBatches };
  }

  const source = await verifyDirection(
    'ph_drive_around_report_rows',
    'ph_drive_around_report_rows_compact',
    'verify_source'
  );
  const shadow = await verifyDirection(
    'ph_drive_around_report_rows_compact',
    'ph_drive_around_report_rows',
    'verify_shadow'
  );
  await client.query('commit');

  const evidence = {
    row_count: source.rowCount,
    file_count: source.fileCount,
    rows_hash: source.rowsHash,
    shadow_rows: shadow.rowCount,
    shadow_files: shadow.fileCount,
    shadow_hash: shadow.rowsHash,
    parity_ok: source.rowCount === shadow.rowCount
      && source.fileCount === shadow.fileCount
      && source.rowsHash === shadow.rowsHash
  };
  if (!evidence?.parity_ok) {
    throw new Error(`Compaction parity failed: ${JSON.stringify(evidence)}`);
  }

  await client.query(`
    insert into public.ph_drive_around_compaction_runs (
      phase, cutoff_date, source_rows, shadow_rows, source_hash, shadow_hash,
      manifest, verified_at
    ) values (
      'copy_verified', $1::date, $2::bigint, $3::bigint, $4::text, $5::text,
      $6::jsonb, now()
    )
  `, [
    cutoffDate,
    evidence.row_count,
    evidence.shadow_rows,
    String(evidence.rows_hash),
    String(evidence.shadow_hash),
    JSON.stringify({ release: 'V2026.08.16.10-backend-cleanup', batches, copied, fileCount: evidence.file_count })
  ]);

  process.stdout.write(`${JSON.stringify({ phase: 'verified', batches, copied, ...evidence })}\n`);
} finally {
  await client.end();
}
