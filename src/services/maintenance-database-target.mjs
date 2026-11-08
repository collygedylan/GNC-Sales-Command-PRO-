function matchesOfficialCliPooler(database, user, projectRef, linked) {
  return linked?.linkedProjectRef === projectRef
    && linked?.poolerHost === database.hostname
    && database.hostname.endsWith('.pooler.supabase.com')
    && database.port === '5432'
    && user === `cli_login_postgres.${projectRef}`;
}

export function validateDatabaseTarget(connectionString, supabaseUrl, linked) {
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
  const cliPooler = matchesOfficialCliPooler(database, user, match[1], linked);
  if ((!direct && !pooler && !cliPooler) || !database.password || database.pathname !== '/postgres') {
    throw new Error('LOW_STOCK_DATABASE_TARGET_MISMATCH');
  }
  if (pooler && database.port === '6543') database.port = '5432';
  // pg query parameters must never override the validated host or identity.
  const allowed = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'application_name']);
  for (const key of database.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID');
  }
  if (!database.searchParams.has('sslmode')) database.searchParams.set('sslmode', 'verify-full');
  if (!['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode'))) {
    throw new Error('LOW_STOCK_DATABASE_TLS_REQUIRED');
  }
  database.searchParams.set('sslmode', 'verify-full');
  return database.toString();
}
