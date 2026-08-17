#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const execute = process.argv.includes('--execute');
const url = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const targetDomain = 'greenleafnursery.com';

if (!url || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. The script defaults to dry-run.');
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
}

function targetEmail(username) {
  const localPart = normalizeUsername(username);
  if (!localPart) throw new Error('invalid_username');
  return `${localPart}@${targetDomain}`;
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

async function waitWithJitter(attempt) {
  const cap = Math.min(8_000, 500 * (2 ** attempt));
  await new Promise((resolve) => setTimeout(resolve, Math.floor(cap / 2 + Math.random() * cap / 2)));
}

async function updateEmailWithRetry(userId, email) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true
    });
    if (!error && data?.user?.id === userId && String(data.user.email || '').toLowerCase() === email) return;
    lastError = error || new Error('email_reconciliation_failed');
    const status = Number(lastError?.status || 0);
    if (attempt === 3 || (status && status !== 429 && status < 500)) break;
    await waitWithJitter(attempt);
  }
  throw lastError || new Error('email_update_failed');
}

const { data: profiles, error: profilesError } = await admin
  .from('profiles')
  .select('id,username')
  .order('username');
if (profilesError) throw profilesError;

const authUsers = await listAuthUsers();
const authById = new Map(authUsers.map((user) => [user.id, user]));
const targetOwners = new Map();
const migration = [];

for (const profile of profiles || []) {
  const user = authById.get(profile.id);
  if (!user) throw new Error(`missing_auth_user:${profile.id}`);
  const email = targetEmail(profile.username);
  if (targetOwners.has(email) && targetOwners.get(email) !== profile.id) throw new Error(`duplicate_target_email:${email}`);
  targetOwners.set(email, profile.id);
  migration.push({
    id: profile.id,
    username: normalizeUsername(profile.username),
    from: String(user.email || '').trim().toLowerCase(),
    to: email
  });
}

const authEmails = new Map(authUsers.map((user) => [String(user.email || '').trim().toLowerCase(), user.id]));
for (const row of migration) {
  const owner = authEmails.get(row.to);
  if (owner && owner !== row.id) throw new Error(`target_email_already_in_use:${row.to}`);
}

const pending = migration.filter((row) => row.from !== row.to);
if (execute) {
  for (const row of pending) await updateEmailWithRetry(row.id, row.to);
}

const verifiedUsers = execute ? await listAuthUsers() : authUsers;
const verifiedById = new Map(verifiedUsers.map((user) => [user.id, String(user.email || '').trim().toLowerCase()]));
const remaining = migration.filter((row) => verifiedById.get(row.id) !== row.to);

process.stdout.write(`${JSON.stringify({
  execute,
  targetDomain,
  profiles: migration.length,
  pendingBeforeRun: pending.length,
  migrated: execute ? pending.length - remaining.length : 0,
  remaining: remaining.length,
  passwordDataRead: false,
  userIdsChanged: false
}, null, 2)}\n`);

if (execute && remaining.length) process.exitCode = 1;
