#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const execute = process.argv.includes('--execute');
const url = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function authAlias(username) {
  const localPart = normalizeUsername(username)
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (!localPart) throw new Error('Cannot generate an Auth alias for an empty username.');
  return `${localPart}@auth.agmetricapp.invalid`;
}

async function listAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < 1000) return users;
  }
}

const { data: legacyUsers, error: legacyError } = await admin
  .from('ph_app_users')
  .select('id,username,password,role,division,language,must_change_password,locked_until,disabled_at')
  .order('id');
if (legacyError) throw legacyError;

const existingAuthUsers = await listAuthUsers();
const existingByEmail = new Map(existingAuthUsers.map((user) => [String(user.email || '').toLowerCase(), user]));
const report = [];

for (const legacy of legacyUsers || []) {
  const username = normalizeUsername(legacy.username);
  const email = authAlias(username);
  const password = String(legacy.password || '');
  const existing = existingByEmail.get(email);
  let authUser = existing || null;
  let action = existing ? 'reconcile' : 'create';

  if (!password && !existing) {
    report.push({ legacyUserId: legacy.id, username, action: 'blocked', reason: 'missing_plaintext_password' });
    continue;
  }

  if (execute && !authUser) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        role: String(legacy.role || 'User'),
        legacy_user_id: legacy.id
      },
      user_metadata: { username }
    });
    if (error) throw new Error(`Auth create failed for ${username}: ${error.message}`);
    authUser = data.user;
    existingByEmail.set(email, authUser);
  }

  if (execute && authUser) {
    const { error } = await admin.from('profiles').upsert({
      id: authUser.id,
      legacy_user_id: legacy.id,
      username,
      display_name: username,
      role: String(legacy.role || 'User'),
      division: String(legacy.division || '10'),
      language: String(legacy.language || 'English'),
      must_change_password: legacy.must_change_password === true,
      locked_until: legacy.locked_until || null,
      disabled_at: legacy.disabled_at || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw new Error(`Profile upsert failed for ${username}: ${error.message}`);
  }

  report.push({
    legacyUserId: legacy.id,
    username,
    action: execute ? action : `dry_run_${action}`,
    authUserId: authUser?.id || null,
    disabled: Boolean(legacy.disabled_at),
    locked: Boolean(legacy.locked_until),
    mustChangePassword: legacy.must_change_password === true
  });
}

// This reconciliation output intentionally excludes passwords, hashes, salts,
// internal aliases, session tokens, and service credentials.
process.stdout.write(`${JSON.stringify({ execute, users: report.length, report }, null, 2)}\n`);
