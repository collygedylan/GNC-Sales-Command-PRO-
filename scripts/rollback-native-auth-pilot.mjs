#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const execute = process.argv.includes('--execute');
const url = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const aliasDomain = '@auth.agmetricapp.invalid';

if (!url || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

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

const { data: profiles, error: profileError } = await admin
  .from('profiles')
  .select('id,legacy_user_id,username')
  .not('legacy_user_id', 'is', null)
  .order('legacy_user_id');
if (profileError) throw profileError;

const authUsers = await listAuthUsers();
const authById = new Map(authUsers.map((user) => [user.id, user]));
const targets = [];

for (const profile of profiles || []) {
  const user = authById.get(profile.id);
  const email = String(user?.email || '').toLowerCase();
  const normalizedUsername = String(profile.username || '').trim().toLowerCase();
  if (!user || !profile.legacy_user_id || !normalizedUsername || !email.endsWith(aliasDomain)) {
    throw new Error(`Pilot rollback safety check failed for profile ${profile.id}.`);
  }
  if (email !== `${normalizedUsername}${aliasDomain}`) {
    throw new Error(`Pilot rollback alias mismatch for profile ${profile.id}.`);
  }
  targets.push({ id: user.id, legacyUserId: profile.legacy_user_id, username: normalizedUsername });
}

if (execute) {
  for (const target of targets) {
    const { error } = await admin.auth.admin.deleteUser(target.id);
    if (error) throw new Error(`Pilot rollback failed for legacy user ${target.legacyUserId}: ${error.message}`);
  }
}

process.stdout.write(`${JSON.stringify({
  execute,
  targets: targets.length,
  report: targets.map(({ legacyUserId, username }) => ({ legacyUserId, username }))
}, null, 2)}\n`);
