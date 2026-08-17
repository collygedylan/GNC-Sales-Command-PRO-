#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const execute = process.argv.includes('--execute');
const synchronizeExistingPasswords = process.argv.includes('--sync-existing-passwords');
const url = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
const configuredMinimum = Number(process.env.SUPABASE_NATIVE_PASSWORD_MIN_LENGTH || 6);
const nativePasswordMinimum = Number.isFinite(configuredMinimum)
  ? Math.max(6, Math.floor(configuredMinimum))
  : 6;

if (!url || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

function createPasswordParityClient() {
  if (!publishableKey) return null;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableParityError(error) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return status === 429 || status >= 500 || code.includes('rate') || message.includes('rate limit') || message.includes('too many requests');
}

async function verifyPasswordParity({ email, password, authUserId, legacyUserId }) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parityClient = createPasswordParityClient();
    const { data, error } = await parityClient.auth.signInWithPassword({ email, password });
    if (!error && data?.user?.id === authUserId && data?.session) {
      return { ok: true, attempts: attempt + 1 };
    }
    lastError = error || new Error('session_user_mismatch');
    if (!isRetryableParityError(lastError) || attempt === 4) break;
    const cap = Math.min(8_000, 750 * (2 ** attempt));
    await wait(Math.floor((cap / 2) + (Math.random() * cap / 2)));
  }
  const safeCode = String(lastError?.code || 'password_parity_failed').slice(0, 80);
  const safeStatus = Number(lastError?.status || 0) || null;
  throw new Error(`Password parity verification failed for legacy user ${legacyUserId} (${safeCode}${safeStatus ? `/${safeStatus}` : ''}).`);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function authAlias(username) {
  const localPart = normalizeUsername(username)
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (!localPart) throw new Error('Cannot generate an Auth alias for an empty username.');
  return `${localPart}@greenleafnursery.com`;
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

  // Supabase Auth rejects passwords below the configured minimum. Keep those
  // accounts on the legacy side of the dual-auth bridge until the user changes
  // the password; do not weaken the project-wide Auth policy or change their
  // existing login behind their back.
  if (!existing && password.length < nativePasswordMinimum) {
    report.push({
      legacyUserId: legacy.id,
      username,
      action: 'deferred',
      reason: 'password_below_native_minimum',
      requiredLength: nativePasswordMinimum,
      currentLength: password.length,
      mustChangePassword: legacy.must_change_password === true
    });
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
    if (existing && synchronizeExistingPasswords) {
      if (!password || password.length < nativePasswordMinimum) {
        throw new Error(`Existing Auth password cannot be synchronized for legacy user ${legacy.id}: password is below the native minimum.`);
      }
      const { error: passwordSyncError } = await admin.auth.admin.updateUserById(authUser.id, {
        password,
        email_confirm: true,
        app_metadata: {
          ...(authUser.app_metadata || {}),
          role: String(legacy.role || 'User'),
          legacy_user_id: legacy.id
        },
        user_metadata: {
          ...(authUser.user_metadata || {}),
          username
        }
      });
      if (passwordSyncError) throw new Error(`Auth password synchronization failed for legacy user ${legacy.id}: ${passwordSyncError.message}`);
      action = 'synchronize';
    }
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

  let passwordParityVerified = null;
  let passwordParityAttempts = null;
  if (execute && authUser && publishableKey) {
    // Pace verification so an administrative migration cannot become an Auth
    // request spike. Retry only rate-limit and transient server failures.
    await wait(650 + Math.floor(Math.random() * 350));
    const parity = await verifyPasswordParity({
      email,
      password,
      authUserId: authUser.id,
      legacyUserId: legacy.id
    });
    passwordParityVerified = parity.ok;
    passwordParityAttempts = parity.attempts;
  }

  report.push({
    legacyUserId: legacy.id,
    username,
    action: execute ? action : `dry_run_${action}`,
    authUserId: authUser?.id || null,
    disabled: Boolean(legacy.disabled_at),
    locked: Boolean(legacy.locked_until),
    mustChangePassword: legacy.must_change_password === true,
    passwordParityVerified,
    passwordParityAttempts
  });
}

// This reconciliation output intentionally excludes passwords, hashes, salts,
// internal aliases, session tokens, and service credentials.
const summary = {
  create: report.filter((row) => row.action === 'create' || row.action === 'dry_run_create').length,
  reconcile: report.filter((row) => row.action === 'reconcile' || row.action === 'dry_run_reconcile').length,
  synchronize: report.filter((row) => row.action === 'synchronize').length,
  deferred: report.filter((row) => row.action === 'deferred').length,
  blocked: report.filter((row) => row.action === 'blocked').length,
  parityVerified: report.filter((row) => row.passwordParityVerified === true).length
};

process.stdout.write(`${JSON.stringify({ execute, users: report.length, summary, report }, null, 2)}\n`);
