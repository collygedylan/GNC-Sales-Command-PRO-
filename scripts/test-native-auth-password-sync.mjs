#!/usr/bin/env node
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
const expectedProjectRef = String(process.env.EXPECTED_PROJECT_REF || '').trim();

if (!url || !serviceRoleKey || !publishableKey || !expectedProjectRef) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY, and EXPECTED_PROJECT_REF are required.');
}
const projectRef = new URL(url).hostname.split('.')[0];
if (projectRef !== expectedProjectRef) throw new Error('Refusing to run against an unexpected Supabase project.');

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const createBrowser = () => createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const nonce = crypto.randomBytes(12).toString('hex');
const username = `native_password_sync_${nonce}`;
const email = `${username}@greenleafnursery.com`;
const originalPassword = `Original-${crypto.randomBytes(18).toString('base64url')}`;
const nextPassword = `Updated-${crypto.randomBytes(18).toString('base64url')}`;
let authUserId = '';
let legacyUserId = null;

try {
  const { data: legacy, error: legacyError } = await admin
    .from('ph_app_users')
    .insert({
      username,
      password: originalPassword,
      role: 'Admin',
      must_change_password: true,
      division: '10',
      language: 'English'
    })
    .select('id')
    .single();
  if (legacyError || !legacy?.id) throw legacyError || new Error('Legacy fixture was not created.');
  legacyUserId = legacy.id;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: originalPassword,
    email_confirm: true,
    app_metadata: { role: 'Admin', legacy_user_id: legacyUserId, smoke_fixture: true },
    user_metadata: { username }
  });
  if (createError || !created?.user?.id) throw createError || new Error('Auth fixture was not created.');
  authUserId = created.user.id;

  const { error: profileError } = await admin.from('profiles').insert({
    id: authUserId,
    legacy_user_id: legacyUserId,
    username,
    display_name: 'Password sync smoke fixture',
    role: 'Admin',
    division: '10',
    language: 'English',
    must_change_password: true,
    passkey_pilot: true
  });
  if (profileError) throw profileError;

  const legacyLogin = async (password) => {
    const response = await fetch(`${url}/functions/v1/app-api`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'login', username, password })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || !payload?.session?.token) {
      throw new Error(`Legacy compatibility login failed (${response.status}).`);
    }
    return payload;
  };
  await legacyLogin(originalPassword);

  const initialBrowser = createBrowser();
  const { data: signedIn, error: signInError } = await initialBrowser.auth.signInWithPassword({
    email,
    password: originalPassword
  });
  if (signInError || !signedIn?.session?.access_token) throw signInError || new Error('Fixture could not sign in.');

  const response = await fetch(`${url}/functions/v1/app-api`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${signedIn.session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'password_change',
      newPassword: nextPassword,
      confirmPassword: nextPassword
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !payload?.session?.token) {
    throw new Error(`Password synchronization endpoint failed (${response.status}/${payload?.code || 'unknown'}).`);
  }

  const parityBrowser = createBrowser();
  const { data: nextSignIn, error: nextSignInError } = await parityBrowser.auth.signInWithPassword({
    email,
    password: nextPassword
  });
  if (nextSignInError || nextSignIn?.user?.id !== authUserId) {
    throw nextSignInError || new Error('Updated native password did not resolve to the fixture account.');
  }

  const [{ data: legacyAfter, error: legacyAfterError }, { data: profileAfter, error: profileAfterError }] = await Promise.all([
    admin.from('ph_app_users').select('password,must_change_password,failed_login_count,locked_until').eq('id', legacyUserId).single(),
    admin.from('profiles').select('must_change_password,locked_until').eq('id', authUserId).single()
  ]);
  if (legacyAfterError || profileAfterError) throw legacyAfterError || profileAfterError;
  if (legacyAfter.password !== nextPassword || legacyAfter.must_change_password || Number(legacyAfter.failed_login_count) !== 0 || legacyAfter.locked_until) {
    throw new Error('Legacy password state did not synchronize.');
  }
  if (profileAfter.must_change_password || profileAfter.locked_until) {
    throw new Error('Profile password state did not synchronize.');
  }
  await legacyLogin(nextPassword);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    projectRef,
    nativePasswordUpdated: true,
    legacyPasswordSynchronized: true,
    legacyCompatibilityLogin: true,
    profileStateSynchronized: true,
    compatibilitySessionIssued: true
  }, null, 2)}\n`);
} finally {
  if (authUserId) await admin.auth.admin.deleteUser(authUserId).catch(() => null);
  if (legacyUserId) {
    try {
      await admin.from('ph_app_users').delete().eq('id', legacyUserId);
    } catch (_error) {
      // The exact fixture ID remains available for deterministic cleanup.
    }
  }
}
