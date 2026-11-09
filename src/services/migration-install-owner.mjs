export async function installMissingReleaseMigration({ client, version, name, body, baselineVersion, includedInBaseline, onPhase }) {
  const baseline = await client.query('select name from supabase_migrations.schema_migrations where version = $1', [baselineVersion]);
  if (baseline.rows.length && includedInBaseline) {
    if (baseline.rows.length !== 1 || baseline.rows[0].name !== 'production_baseline') throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
    return 'included_in_baseline';
  }
  onPhase('migration_sql');
  await client.query(body);
  onPhase('migration_history_write');
  await client.query('insert into supabase_migrations.schema_migrations(version,name,statements) values ($1,$2,$3)', [version, name, [body]]);
  return 'applied';
}
