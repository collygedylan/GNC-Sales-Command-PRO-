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
