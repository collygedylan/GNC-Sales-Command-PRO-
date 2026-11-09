import { readFileSync } from 'node:fs';
import { latestMigrationFunctionDefinition } from '../../scripts/migration-function-source.mjs';

const filename = '20261014173230_suspend_tag_close_inventory_sync.sql';

export function historicalSuspendCloseCommand() {
  const sql = readFileSync(new URL(`../../supabase/migrations/${filename}`, import.meta.url), 'utf8');
  return latestMigrationFunctionDefinition({
    sources: [{ filename, sql }],
    schema: 'suspend_tag_private',
    name: 'command',
    argumentTypes: ['uuid', 'text', 'jsonb', 'uuid', 'bigint'],
  });
}

export async function measureHistoricalSuspendCommand(db, args) {
  const { rows } = await db.query(`
    with timing as materialized (select clock_timestamp() as started_at),
    receipt as materialized (
      select public.suspend_tag_command_v1($1,$2,$3,$4,$5,$6) as result, started_at from timing
    )
    select result, (extract(epoch from (clock_timestamp()-started_at))*1000)::float8 as elapsed_ms
    from receipt
  `, args);
  return rows[0];
}
