import fs from 'node:fs/promises';
import pg from 'pg';
import { validateDatabaseTarget } from './maintenance-database-target.mjs';

export async function connectHistoryMaintenanceDatabase() {
  const local = await fs.readFile('.env', 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const source = process.env.GNC_HISTORY_DATABASE_URL || local.match(/^GNC_SUPABASE_DB_URL\s*=\s*(.+)$/m)?.[1]
    ?.trim().replace(/^['"]|['"]$/g, '');
  const url = new URL(validateDatabaseTarget(source, 'https://kzrnyjsosryejjejliii.supabase.co'));
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(key);
  const ca = await fs.readFile(new URL('../../scripts/certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8');
  const client = new pg.Client({ connectionString: url.toString(), ssl: { ca }, connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000, application_name: 'gnc_history_delta_maintenance' });
  await client.connect();
  return client;
}
