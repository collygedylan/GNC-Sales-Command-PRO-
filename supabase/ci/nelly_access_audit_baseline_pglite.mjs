// Isolated contract test for the Nelly access-audit baseline repair.
// This runner creates only an in-memory PGlite database and never connects to Supabase.
// node supabase/ci/nelly_access_audit_baseline_pglite.mjs --pglite-root .gnc-local/pglite
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw Error('Pass --pglite-root');
const { PGlite } = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))('@electric-sql/pglite');
const migration = fs.readFileSync(new URL('../migrations/20261002134138_nelly_access_audit_baseline_repair_007.sql', import.meta.url), 'utf8');
const historyFixture = fs.readFileSync(new URL('./nelly_access_audit_baseline_snapshot_fixture.sql', import.meta.url), 'utf8');

async function createFixture({ username = 'nelly_aguilar', role = 'Admin', disabledAt = null, existingBaseline = false } = {}) {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`
    create schema private;
    create table public.profiles(
      id uuid primary key, username text not null, role text not null,
      disabled_at timestamptz, locked_until timestamptz, must_change_password boolean not null default false,
      legacy_user_id integer
    );
    create table public.ph_app_users(
      id integer primary key, username text not null, disabled_at timestamptz,
      locked_until timestamptz, must_change_password boolean not null default false
    );
    create table private.app_access_permissions(permission_key text primary key, active boolean not null default true);
    create table private.app_access_legacy_baseline(
      profile_id uuid not null references public.profiles(id),
      permission_key text not null references private.app_access_permissions(permission_key),
      allowed boolean not null, access_scope text, captured_at timestamptz not null default now(),
      primary key(profile_id, permission_key)
    );
    create table private.app_access_role_grants(role_key text, permission_key text, allowed boolean, access_scope text);
    create table private.fixture_effective_permissions(
      profile_id uuid, policy_id bigint, permission_key text, permission_kind text,
      module_key text, label text, description text, scope_options text[], sort_order integer,
      allowed boolean, access_scope text, decision_source text
    );
    insert into public.profiles(id,username,role,disabled_at,legacy_user_id)
      values('961b0a0f-11a6-4db5-b066-582f772ab8e7',$$${username}$$,$$${role}$$,${disabledAt ? `'${disabledAt}'::timestamptz` : 'null'},42);
    insert into public.ph_app_users(id,username) values(42,'nelly_aguilar');
    insert into private.app_access_permissions(permission_key)
      select 'permission.' || lpad(i::text,3,'0') from generate_series(1,80) i;
    insert into private.fixture_effective_permissions
      select '961b0a0f-11a6-4db5-b066-582f772ab8e7',1,
        'permission.' || lpad(i::text,3,'0'),'action','fixture','Permission '||i,'',
        array[]::text[],i,(i<=50),case when i<=50 then 'global' else null end,'role'
      from generate_series(1,80) i;
    insert into private.app_access_role_grants
      select 'ADMIN','permission.'||lpad(i::text,3,'0'),i<=50,case when i<=50 then 'global' else null end
      from generate_series(1,80) i;
    ${existingBaseline ? `
      -- Mirrors the two Nelly rows inserted by the historical isolated handover fixture.
      insert into private.app_access_legacy_baseline(profile_id,permission_key,allowed,access_scope)
      values('961b0a0f-11a6-4db5-b066-582f772ab8e7','permission.001',false,null),
            ('961b0a0f-11a6-4db5-b066-582f772ab8e7','permission.002',true,'global');
    ` : ''}
    create function private.normalized_profile_role(text) returns text language sql immutable as $$
      select upper(btrim($1))
    $$;
    create function private.resolve_app_access_policy_id_v1(boolean) returns bigint language sql stable as $$
      select 1::bigint
    $$;
    create function private.get_effective_app_permissions_v1(uuid,bigint)
      returns table(permission_key text,permission_kind text,module_key text,label text,description text,
        scope_options text[],sort_order integer,allowed boolean,access_scope text,decision_source text)
      language sql stable as $$
        select f.permission_key,f.permission_kind,f.module_key,f.label,f.description,
          f.scope_options,f.sort_order,f.allowed,f.access_scope,f.decision_source
        from private.fixture_effective_permissions f
        where f.profile_id=$1 and f.policy_id=$2
        order by f.sort_order,f.permission_key
      $$;
  `);
  return db;
}

const db = await createFixture();
try {
  await db.exec(migration);
  const first = (await db.query(`select count(*)::int as total,
      count(*) filter(where allowed)::int as allowed,
      count(*) filter(where not allowed)::int as denied
    from private.app_access_legacy_baseline
    where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'`)).rows[0];
  assert.deepEqual(first, { total: 80, allowed: 50, denied: 30 });
  const grantsBefore = (await db.query('select * from private.app_access_role_grants order by permission_key')).rows;
  const profileBefore = (await db.query(`select id,username,role,disabled_at,locked_until,must_change_password,legacy_user_id
    from public.profiles where id='961b0a0f-11a6-4db5-b066-582f772ab8e7'`)).rows;

  await db.exec(migration);
  assert.deepEqual((await db.query(`select count(*)::int as total from private.app_access_legacy_baseline
    where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'`)).rows[0], { total: 80 }, 'rerun is idempotent');

  await db.exec(`update private.app_access_legacy_baseline set allowed=false,access_scope=null
    where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7' and permission_key='permission.001'`);
  await db.exec(migration);
  assert.deepEqual((await db.query(`select allowed,access_scope from private.app_access_legacy_baseline
    where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7' and permission_key='permission.001'`)).rows[0],
  { allowed: false, access_scope: null }, 'existing baseline records are never overwritten');
  assert.deepEqual((await db.query('select * from private.app_access_role_grants order by permission_key')).rows, grantsBefore,
    'role grants remain unchanged');
  assert.deepEqual((await db.query(`select id,username,role,disabled_at,locked_until,must_change_password,legacy_user_id
    from public.profiles where id='961b0a0f-11a6-4db5-b066-582f772ab8e7'`)).rows, profileBefore,
  'profile role and account state remain unchanged');
  await db.close();

  for (const options of [{ username: 'wrong_user' }, { role: 'Sales' }, { disabledAt: '2026-01-01T00:00:00Z' }]) {
    const invalid = await createFixture(options);
    await assert.rejects(invalid.exec(migration), /NELLY_BASELINE_TARGET_IDENTITY_MISMATCH/);
    await invalid.exec('rollback');
    assert.equal((await invalid.query('select count(*)::int as count from private.app_access_legacy_baseline')).rows[0].count, 0,
      'identity mismatch rolls back without writing audit records');
    await invalid.close();
  }

  const historical = await createFixture({ existingBaseline: true });
  await historical.exec(historyFixture);
  await historical.exec(migration);
  assert.deepEqual((await historical.query(`select count(*)::int as total from private.app_access_legacy_baseline
    where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'`)).rows[0], { total: 80 },
  'historical preexisting baseline rows do not prevent complete coverage');
  assert.deepEqual((await historical.query(`select permission_key,allowed,access_scope from private.app_access_legacy_baseline
    where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7' and permission_key in ('permission.001','permission.002')
    order by permission_key`)).rows,
  [
    { permission_key: 'permission.001', allowed: false, access_scope: null },
    { permission_key: 'permission.002', allowed: true, access_scope: 'global' },
  ], 'historical baseline rows are preserved even if current resolution differs');
  assert.deepEqual((await historical.query(`select count(*)::int as count from private.get_effective_app_permissions_v1(
    '961b0a0f-11a6-4db5-b066-582f772ab8e7',1) effective
    join private.app_access_legacy_baseline baseline using(permission_key)
    where baseline.profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'
      and effective.permission_key not in ('permission.001','permission.002')
      and (baseline.allowed is distinct from effective.allowed or baseline.access_scope is distinct from effective.access_scope)`)).rows[0],
  { count: 0 }, 'new historical-fixture baseline rows use the current resolver');
  assert.deepEqual((await historical.query(`select count(*)::int as count
    from private.ci_nelly_baseline_before_repair snapshot
    left join private.app_access_legacy_baseline baseline
      on baseline.profile_id=snapshot.profile_id and baseline.permission_key=snapshot.permission_key
    where baseline.permission_key is null or baseline.allowed is distinct from snapshot.allowed
      or baseline.access_scope is distinct from snapshot.access_scope
      or baseline.captured_at is distinct from snapshot.captured_at`)).rows[0],
  { count: 0 }, 'the real isolated replay snapshot remains unchanged');
  await historical.close();

  console.log('Nelly access-audit baseline PGlite contract passed.');
} finally {
  // `db` can already be closed after the passing branch; close is harmlessly guarded.
  try { await db.close(); } catch { /* already closed */ }
}
