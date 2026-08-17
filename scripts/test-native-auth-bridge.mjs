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
const browser = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const nonce = crypto.randomBytes(12).toString('hex');
const email = `native-bridge-smoke-${nonce}@greenleafnursery.com`;
const username = `native_bridge_smoke_${nonce}`;
const password = `T3st-${crypto.randomBytes(18).toString('base64url')}`;
let userId = '';

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'Admin', smoke_fixture: true },
    user_metadata: { username }
  });
  if (createError || !created?.user?.id) throw createError || new Error('Fixture Auth user was not created.');
  userId = created.user.id;

  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    username,
    display_name: 'Native bridge smoke fixture',
    role: 'Admin',
    division: '10',
    language: 'English'
  });
  if (profileError) throw profileError;

  const { data: signedIn, error: signInError } = await browser.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn?.session?.access_token) throw signInError || new Error('Fixture could not sign in.');

  const bridgeResponse = await fetch(`${url}/functions/v1/app-api`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${signedIn.session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'native_session_bridge' })
  });
  const bridgePayload = await bridgeResponse.json().catch(() => null);
  if (!bridgeResponse.ok || !bridgePayload?.ok || !bridgePayload?.session?.token) {
    throw new Error(`Native bridge failed (${bridgeResponse.status}).`);
  }
  if (String(bridgePayload.session.token).split('.').length !== 2) {
    throw new Error('Native bridge returned an invalid compatibility token.');
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    projectRef,
    nativeSignIn: true,
    compatibilityToken: true,
    expiresAtPresent: Number(bridgePayload.session.expiresAt || 0) > Date.now()
  }, null, 2) + '\n');
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId).catch(() => null);
  }
}
