import fs from 'node:fs/promises';
import path from 'node:path';
import { planConsecutiveHistoricalStates, requestArchivePath } from '../src/services/history-delta-review.mjs';
import { connectHistoryMaintenanceDatabase } from '../src/services/history-maintenance-database.mjs';

async function connectReadOnly() {
  const database = await connectHistoryMaintenanceDatabase();
  await database.query('begin read only');
  await database.query("set local statement_timeout='15s'");
  await database.query("set local lock_timeout='1s'");
  return database;
}

async function sampleDriveHistory(database, itemcode) {
  const files = (await database.query(`select file_id,row_number() over(order by coalesce(canonical_report_date,report_date),
    coalesce(canonical_sequence,999999),coalesce(nullif(btrim(canonical_file_name),''),file_name),file_id)::integer as file_sequence
    from public.ph_drive_around_report_files`)).rows;
  const sequences = new Map(files.map(row => [row.file_id, row.file_sequence]));
  const result = await database.query(`select * from public.ph_drive_around_report_rows
    where itemcode=$1 order by report_date,file_id,row_number limit 10001`, [itemcode]);
  if (result.rows.length > 10_000) throw new Error('HISTORY_AUDIT_SAMPLE_TOO_LARGE');
  const observations = result.rows.map(row => ({ ...row, file_sequence: sequences.get(row.file_id) }));
  observations.sort((left, right) => left.file_sequence - right.file_sequence);
  const plan = planConsecutiveHistoricalStates(observations, {
    keyFields: ['itemcode', 'locationcode', 'lotcode', 'season', 'saleyear'],
  });
  return { itemcode, observations: observations.length, stateChangesKept: plan.kept.length,
    consecutiveUnchangedCandidates: plan.duplicateIds.length, coverage: plan.coverage };
}

async function inspectMetadata(database) {
  const tables = await database.query(`select c.oid::regclass::text as relation,
    c.reltuples::bigint as estimated_rows,pg_total_relation_size(c.oid)::text as total_bytes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in('public','private','import_private') and c.relkind in('r','p') and
      (c.relname like '%history%' or c.relname like '%hold_stop%'
       or c.relname like '%report_rows%' or c.relname like '%import%')
    order by pg_total_relation_size(c.oid) desc`);
  const history = await database.query(`select to_jsonb(h) as row
    from public.ph_requests_completed_history h order by id limit 5`);
  const watchdog = await database.query("select count(*)::integer as open from public.app_runtime_watchdog_events where status='open'");
  const legacyJobs = await database.query(`select jobid,jobname,schedule,command,active from cron.job
    where jobid=56 and jobname='agdata_historical_state_dedup_v2366'
      and command='select private.run_historical_state_dedup_v2366();'`);
  const fileReceipts = await database.query(`select dataset,status,count(*) files,sum(expected_rows) expected_rows,
    sum(staged_rows) staged_rows,count(*) filter(where expected_rows=0) empty_files
    from import_private.import_history_files group by dataset,status order by dataset,status`);
  return { tables: tables.rows, privateImportFileReceipts: fileReceipts.rows,
    requestPaths: history.rows.map(({ row }) => requestArchivePath(row)),
    openWatchdogIncidents: watchdog.rows[0].open, legacyDedupJobs: legacyJobs.rows };
}

async function audit() {
  const args = process.argv.slice(2);
  if (args.some(argument => !argument.startsWith('--itemcode='))) throw new Error('HISTORY_AUDIT_ARGUMENT_INVALID');
  const itemcode = args.find(argument => argument.startsWith('--itemcode='))?.slice(11);
  const database = await connectReadOnly();
  try {
    const report = { observedAt: new Date().toISOString(), productionWrites: 0, rowsPruned: 0,
      bytesReclaimed: 0, relationRowCountsAreEstimates: true, ...await inspectMetadata(database),
      sample: itemcode ? await sampleDriveHistory(database, itemcode) : null,
      rolloutBlockers: ['Raw Drive/Hold file-membership readers require coverage-manifest migration.',
        'No live deduplication or VACUUM has run; no GB reduction is claimed.'] };
    const directory = 'G:/My Drive/GNC/AgData/Release Evidence';
    await fs.mkdir(directory, { recursive: true });
    const output = path.join(directory, 'phaseb3039-history-delta-audit.json');
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ report: output, productionWrites: 0,
      openWatchdogIncidents: report.openWatchdogIncidents,
      unsafeLegacyDedupJobActive: report.legacyDedupJobs.some(job => job.active), sample: report.sample && {
        observations: report.sample.observations, stateChangesKept: report.sample.stateChangesKept,
        consecutiveUnchangedCandidates: report.sample.consecutiveUnchangedCandidates,
      } }) + '\n');
  } finally {
    await database.query('rollback');
    await database.end();
  }
}

audit().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
