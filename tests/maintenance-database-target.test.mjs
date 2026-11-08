import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDatabaseTarget } from '../src/services/maintenance-database-target.mjs';

const projectRef = 'kzrnyjsosryejjejliii';
const api = `https://${projectRef}.supabase.co`;
const host = 'aws-1-us-east-1.pooler.supabase.com';
const linked = { linkedProjectRef: projectRef, poolerHost: host };
const connection = (role = `cli_login_postgres.${projectRef}`, hostname = host, port = '5432') =>
  `postgresql://${role}:example@${hostname}:${port}/postgres`;

test('official CLI role requires exact linked project, pooler host and session port', () => {
  const value = new URL(validateDatabaseTarget(connection(), api, linked));
  assert.equal(value.hostname, host);
  assert.equal(value.username, `cli_login_postgres.${projectRef}`);
  assert.equal(value.port, '5432');
  assert.equal(value.searchParams.get('sslmode'), 'verify-full');
});

test('wrong project, role, host, port and missing linked proof are rejected', () => {
  const unsafe = [connection('cli_login_postgres.otherproject'), connection(`cli_admin.${projectRef}`),
    connection(undefined, 'other.pooler.supabase.com'), connection(undefined, 'evil.example'),
    connection(undefined, host, '6543'), connection(undefined, host, '6432')];
  for (const value of unsafe) assert.throws(() => validateDatabaseTarget(value, api, linked), /TARGET_MISMATCH/);
  assert.throws(() => validateDatabaseTarget(connection(), api), /TARGET_MISMATCH/);
  assert.throws(() => validateDatabaseTarget(connection(), api,
    { ...linked, linkedProjectRef: 'otherproject' }), /TARGET_MISMATCH/);
});

test('CLI target cannot override host, identity or TLS through query parameters', () => {
  assert.throws(() => validateDatabaseTarget(connection() + '?host=evil.example', api, linked), /TARGET_INVALID/);
  assert.throws(() => validateDatabaseTarget(connection() + '?user=postgres', api, linked), /TARGET_INVALID/);
  assert.throws(() => validateDatabaseTarget(connection() + '?sslmode=disable', api, linked), /TLS_REQUIRED/);
});

test('existing direct and postgres pooler forms retain their validation contract', () => {
  assert.ok(validateDatabaseTarget(`postgresql://postgres:example@db.${projectRef}.supabase.co/postgres`, api));
  const pooled = new URL(validateDatabaseTarget(connection(`postgres.${projectRef}`, host, '6543'), api));
  assert.equal(pooled.port, '5432');
  assert.throws(() => validateDatabaseTarget(connection('postgres.otherproject'), api), /TARGET_MISMATCH/);
});
