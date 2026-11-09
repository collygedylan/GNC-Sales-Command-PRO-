import fs from 'node:fs/promises';
import { renameSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connectHistoryMaintenanceDatabase } from '../src/services/history-maintenance-database.mjs';

const RELATIONS = Object.freeze({ drive: 'public.ph_drive_around_report_rows', hold: 'public.ph_hold_stop_itemcode_snapshots',
  import: 'import_private.import_history_rows' });
const EVIDENCE = 'G:/My Drive/GNC/AgData/Release Evidence';
const RETRYABLE = new Set(['55P03', '57014', '40001', '40P01']);

export function historyMaintenanceOptions(args) {
  const flags = new Map();
  for (const argument of args) {
    const match = /^--(relation|mode|limit|resume|vacuum)(?:=(.+))?$/.exec(argument);
    if (!match || flags.has(match[1])) throw new Error('HISTORY_MAINTENANCE_ARGUMENT_INVALID');
    flags.set(match[1], match[2] ?? true);
  }
  const relation = flags.get('relation');
  const mode = flags.get('mode') || 'dry-run';
  const limit = Number(flags.get('limit') || 50);
  if (!Object.hasOwn(RELATIONS, relation) || !['dry-run', 'apply'].includes(mode)
    || !Number.isInteger(limit) || limit < 1 || limit > 500
    || (flags.has('resume') && flags.get('resume') !== true)
    || (flags.has('vacuum') && (flags.get('vacuum') !== true || mode !== 'apply'))) {
    throw new Error('HISTORY_MAINTENANCE_SCOPE_INVALID');
  }
  return { relation, table: RELATIONS[relation], mode, limit, resume: flags.has('resume'), vacuum: flags.has('vacuum') };
}

async function checkInstalledReaders(database, apply, relation) {
  if (relation === 'import') {
    const contract = (await database.query(`select
      to_regprocedure('import_private.compact_import_history_delta_v3039(uuid,integer,integer,boolean)') is not null as installed,
      position('import_history_logical_rows_v3039' in pg_get_functiondef('public.publish_import_history_v1(uuid)'::regprocedure))>0
        and position('import_history_logical_rows_v3039' in pg_get_functiondef('public.get_import_history_rows_v1(uuid,integer,integer)'::regprocedure))>0 as readers`)).rows[0];
    if (!contract.installed || !contract.readers) throw new Error('HISTORY_MIGRATIONS_NOT_INSTALLED');
    return;
  }
  const contract = (await database.query(`select
    to_regprocedure('private.compact_snapshot_item_v3039(regclass,text,boolean)') is not null as installed,
    exists(select 1 from cron.job where jobname='agdata_history_delta_queue_v3039' and active
      and command='select private.process_history_delta_queue_v3039();') as activated,
    exists(select 1 from cron.job where jobid=56 and jobname='agdata_historical_state_dedup_v2366' and active
      and command='select private.run_historical_state_dedup_v2366();') as unsafe_legacy_active`)).rows[0];
  if (!contract.installed) throw new Error('HISTORY_MIGRATIONS_NOT_INSTALLED');
  if (apply && (!contract.activated || contract.unsafe_legacy_active)) throw new Error('HISTORY_EDGE_VERIFICATION_AND_QUEUE_ACTIVATION_REQUIRED');
}

async function importRelationMetrics(database, table) {
  return (await database.query(`select (select count(*) from ${table})::text as exact_rows,'0'::text as unkeyed_rows,
    pg_total_relation_size($1::regclass)::text as total_bytes,pg_table_size($1::regclass)::text as heap_toast_bytes,
    pg_indexes_size($1::regclass)::text as index_bytes,
    pg_total_relation_size('import_private.import_history_coverage_v3039')::text as shared_coverage_bytes,
    pg_total_relation_size('import_private.import_history_states_v3039')::text as shared_state_bytes,
    stats.n_live_tup::text as estimated_live_tuples,stats.n_dead_tup::text as estimated_dead_tuples
    from pg_stat_user_tables stats where stats.relid=$1::regclass`, [table])).rows[0];
}

function maintenanceMetrics(database, options) {
  return options.relation === 'import'
    ? importRelationMetrics(database, options.table) : relationMetrics(database, options.table);
}

async function relationMetrics(database, table) {
  return (await database.query(`select (select count(*) from ${table})::text as exact_rows,
    (select count(*) from ${table} where nullif(btrim(itemcode),'') is null)::text as unkeyed_rows,
    pg_total_relation_size($1::regclass)::text as total_bytes,pg_table_size($1::regclass)::text as heap_toast_bytes,
    pg_indexes_size($1::regclass)::text as index_bytes,
    pg_total_relation_size('private.history_snapshot_coverage_v3039')::text as shared_coverage_bytes,
    pg_total_relation_size('private.history_snapshot_states_v3039')::text as shared_state_bytes,
    stats.n_live_tup::text as estimated_live_tuples,stats.n_dead_tup::text as estimated_dead_tuples
    from pg_stat_user_tables stats where stats.relid=$1::regclass`, [table])).rows[0];
}

async function reusableSpace(database, table) {
  const installed = (await database.query(`select namespace.nspname schema_name
    from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
    join pg_depend dependency on dependency.objid=procedure.oid and dependency.deptype='e'
    join pg_extension extension on extension.oid=dependency.refobjid and extension.extname='pgstattuple'
    where procedure.proname='pgstattuple_approx' and namespace.nspname in('public','extensions')
      and has_function_privilege(current_user,procedure.oid,'execute') limit 1`)).rows[0];
  if (!installed) return { measured: false, reason: 'pgstattuple_approx_not_available' };
  const stats = (await database.query(`select approx_free_space::text,approx_free_percent,dead_tuple_count::text
    from ${installed.schema_name}.pgstattuple_approx($1::regclass)`, [table])).rows[0];
  return { measured: true, approximate: true, ...stats };
}

export async function processHistoryMaintenanceItem(database, { table, itemcode, apply, runId }) {
  await database.query(apply ? 'begin' : 'begin read only');
  try {
    await database.query("set local lock_timeout='1s'; set local statement_timeout='12s'");
    if (apply) await database.query("select set_config('agdata.history_maintenance_run_id',$1,true)", [runId]);
    const result = await database.query('select private.compact_snapshot_item_v3039($1::regclass,$2,$3) as receipt',
      [table, itemcode, apply]);
    await database.query('commit');
    return result.rows[0].receipt;
  } catch (error) {
    await database.query('rollback');
    throw error;
  }
}

export async function processImportHistoryMaintenanceBatch(database, { snapshotId, after, apply }) {
  await database.query(apply ? 'begin' : 'begin read only');
  try {
    await database.query("set local lock_timeout='1s'; set local statement_timeout='12s'");
    const result = await database.query(
      'select import_private.compact_import_history_delta_v3039($1::uuid,$2,500,$3) as receipt',
      [snapshotId, after, apply]);
    await database.query('commit');
    return result.rows[0].receipt;
  } catch (error) {
    await database.query('rollback');
    throw error;
  }
}

async function attemptHistoryMaintenanceItem(database, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await processHistoryMaintenanceItem(database, options); }
    catch (error) {
      if (!RETRYABLE.has(error.code) || attempt === 2) throw error;
      await delay(200 * (2 ** attempt));
    }
  }
}

async function saveCheckpoint(file, state) {
  const temporary = `${file}.next`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, file);
}

async function loadCheckpoint(database, file, options) {
  if (options.resume) {
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state.release !== '3.0.39' || state.table !== options.table || state.mode !== options.mode
      || !/^[0-9a-f-]{36}$/.test(state.runId)) throw new Error('HISTORY_CHECKPOINT_SCOPE_MISMATCH');
    return state;
  }
  const existing = await fs.stat(file).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (existing) throw new Error('HISTORY_CHECKPOINT_EXISTS_USE_RESUME');
  return { release: '3.0.39', table: options.table, mode: options.mode, runId: randomUUID(),
    startedAt: new Date().toISOString(), cursor: '', done: false, processedItems: 0, retainedItems: [],
    exactCandidates: 0, stateChangesKept: 0, rowsRemoved: 0, before: await maintenanceMetrics(database, options) };
}

async function advanceHistoryCheckpoint(database, file, state, options) {
  for (let step = 0; step < options.limit && !state.done; step++) {
    const next = (await database.query(`select itemcode from ${options.table} where itemcode>$1
      and nullif(btrim(itemcode),'') is not null order by itemcode limit 1`, [state.cursor])).rows[0]?.itemcode;
    if (!next) { state.done = true; break; }
    try {
      const receipt = await attemptHistoryMaintenanceItem(database, { table: options.table, itemcode: next,
        apply: options.mode === 'apply', runId: state.runId });
      state.exactCandidates += receipt.physical_rows_eligible;
      state.stateChangesKept += receipt.state_changes_kept;
      state.rowsRemoved += receipt.rows_removed || 0;
    } catch (error) {
      if (error.message !== 'HISTORY_ITEM_EXCEEDS_5000_OBSERVATIONS') throw error;
      state.retainedItems.push({ itemcode: next, reason: 'above_bounded_item_cohort_limit' });
    }
    state.cursor = next;
    state.processedItems += 1;
    await saveCheckpoint(file, state);
  }
}

async function nextImportSnapshot(database, cursor) {
  return (await database.query(`with ordered as (
    select id,row_number() over(order by dataset,report_date,daily_sequence,id) sequence
    from import_private.import_history_files where status='ready' and published_at is not null
      and staged_rows=expected_rows)
    select id::text from ordered where sequence>coalesce(
      (select sequence from ordered where id=nullif($1,'')::uuid),0) order by sequence limit 1`, [cursor])).rows[0]?.id;
}

async function advanceImportCheckpoint(database, file, state, options) {
  for (let step = 0; step < options.limit && !state.done; step++) {
    state.activeSnapshot ||= await nextImportSnapshot(database, state.cursor);
    if (!state.activeSnapshot) { state.done = true; break; }
    const receipt = await attemptImportMaintenanceBatch(database, { snapshotId: state.activeSnapshot,
      after: state.rowCursor || 0, apply: options.mode === 'apply' });
    state.exactCandidates += Number(receipt.eligible || 0);
    state.rowsRemoved += Number(receipt.rows_removed || 0);
    state.processedItems += 1;
    if (receipt.done) {
      state.cursor = state.activeSnapshot;
      state.activeSnapshot = '';
      state.rowCursor = 0;
      state.processedSnapshots = Number(state.processedSnapshots || 0) + 1;
    } else {
      state.rowCursor = Number(receipt.next_row || 0);
    }
    await saveCheckpoint(file, state);
  }
}

async function attemptImportMaintenanceBatch(database, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await processImportHistoryMaintenanceBatch(database, options); }
    catch (error) {
      if (!RETRYABLE.has(error.code) || attempt === 2) throw error;
      await delay(200 * (2 ** attempt));
    }
  }
}

async function finishHistoryCheckpoint(database, state, options) {
  if (!state.done) return;
  if (options.vacuum && !state.vacuumCompletedAt) {
    await database.query("set lock_timeout='1s'; set statement_timeout='120s'");
    await database.query(`VACUUM (ANALYZE, TRUNCATE FALSE) ${options.table}`);
    state.vacuumCompletedAt = new Date().toISOString();
  }
  state.after = await maintenanceMetrics(database, options);
  state.reusableSpace = await reusableSpace(database, options.table);
  state.physicalBytesDelta = Number(state.after.total_bytes) - Number(state.before.total_bytes);
  state.sharedArchiveBytesDelta = Number(state.after.shared_coverage_bytes) + Number(state.after.shared_state_bytes)
    - Number(state.before.shared_coverage_bytes) - Number(state.before.shared_state_bytes);
  state.concurrentNetRows = Number(state.after.exact_rows) - Number(state.before.exact_rows) + state.rowsRemoved;
  state.completedAt = new Date().toISOString();
}

async function main() {
  const options = historyMaintenanceOptions(process.argv.slice(2));
  const file = path.join(EVIDENCE, `phaseb3039-${options.relation}-${options.mode}-checkpoint.json`);
  const database = await connectHistoryMaintenanceDatabase();
  try {
    if (options.mode === 'dry-run') await database.query('set default_transaction_read_only=on');
    await checkInstalledReaders(database, options.mode === 'apply', options.relation);
    const state = await loadCheckpoint(database, file, options);
    await saveCheckpoint(file, state);
    if (options.relation === 'import') await advanceImportCheckpoint(database, file, state, options);
    else await advanceHistoryCheckpoint(database, file, state, options);
    await saveCheckpoint(file, state);
    await finishHistoryCheckpoint(database, state, options);
    await saveCheckpoint(file, state);
    process.stdout.write(`${JSON.stringify({ checkpoint: file, mode: state.mode, done: state.done,
      processedItems: state.processedItems, exactCandidates: state.exactCandidates, rowsRemoved: state.rowsRemoved,
      retainedItems: state.retainedItems.length, physicalBytesDelta: state.physicalBytesDelta,
      sharedArchiveBytesDelta: state.sharedArchiveBytesDelta,
      vacuumCompletedAt: state.vacuumCompletedAt })}\n`);
  } finally { await database.end(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
