export const historicalAuthManifestPath = 'src/services/historical-database-auth-migrations.mjs';

const archivedAuthMigrations = [
  '20260816172822_native_auth_profiles.sql',
  '20260820134500_profiles_service_role_grant.sql',
  '20260831141127_native_auth_profile_link_repair.sql',
  '20260929160000_password_change_profile_reconciliation.sql',
];

const loginRateLimit = '20261021042013_app_login_rate_limit_v1.sql';

export const historicalAuthMigrations = [
  ...archivedAuthMigrations.map(destination => ({ source: `supabase/archive_migrations/${destination}`, destination })),
  { source: `supabase/migrations/${loginRateLimit}`, destination: loginRateLimit },
];
