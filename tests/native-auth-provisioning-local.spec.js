import { test, expect } from '@playwright/test';

const localUrl = String(process.env.SUPABASE_LOCAL_URL || '').replace(/\/$/, '');
const anonKey = String(process.env.SUPABASE_LOCAL_ANON_KEY || '');
const serviceKey = String(process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY || '');

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

const serviceHeaders = () => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json'
});

async function serviceRpc(name, body) {
  return jsonFetch(`${localUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify(body)
  });
}

test.describe('Native Auth password profile reconciliation', () => {
  test.skip(!localUrl || !anonKey || !serviceKey, 'Local Supabase environment is required.');

  test('repairs an orphan profile and atomically synchronizes a forced password change', async () => {
    const suffix = `${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const username = `auth_link_${suffix}`;
    const email = `${username}@example.com`;
    const starterPassword = 'Starter-Auth-2026!';
    const nextPassword = 'Linked-Auth-2026!';
    const fingerprint = 'a'.repeat(64);
    let authUserId = '';
    let legacyUserId = 0;

    try {
      const legacy = await jsonFetch(`${localUrl}/rest/v1/ph_app_users`, {
        method: 'POST',
        headers: { ...serviceHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({
          username,
          password: starterPassword,
          role: 'Manager',
          division: '10',
          language: 'English',
          must_change_password: true
        })
      });
      expect(legacy.response.ok, JSON.stringify(legacy.body)).toBeTruthy();
      legacyUserId = Number(legacy.body[0].id);

      const created = await jsonFetch(`${localUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: serviceHeaders(),
        body: JSON.stringify({ email, password: starterPassword, email_confirm: true })
      });
      expect(created.response.ok, JSON.stringify(created.body)).toBeTruthy();
      authUserId = created.body.id;

      const orphanProfile = await jsonFetch(`${localUrl}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...serviceHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({
          id: authUserId,
          username,
          display_name: username,
          role: 'Manager',
          division: '10',
          language: 'English',
          must_change_password: true
        })
      });
      expect(orphanProfile.response.ok, JSON.stringify(orphanProfile.body)).toBeTruthy();
      expect(orphanProfile.body[0].legacy_user_id).toBeNull();

      const prepared = await serviceRpc('prepare_password_change_profile', {
        p_username: username,
        p_auth_user_id: authUserId,
        p_password_fingerprint: fingerprint
      });
      expect(prepared.response.ok, JSON.stringify(prepared.body)).toBeTruthy();
      expect(prepared.body[0].status).toBe('ready');
      expect(Number(prepared.body[0].legacy_user_id)).toBe(legacyUserId);
      expect(prepared.body[0].role).toBe('Manager');

      const nativePasswordChange = await jsonFetch(`${localUrl}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
        method: 'PUT',
        headers: serviceHeaders(),
        body: JSON.stringify({ password: nextPassword })
      });
      expect(nativePasswordChange.response.ok, JSON.stringify(nativePasswordChange.body)).toBeTruthy();

      const passwordChange = await serviceRpc('complete_password_change_profile', {
        p_attempt_id: prepared.body[0].attempt_id,
        p_auth_user_id: authUserId,
        p_password: nextPassword,
        p_password_fingerprint: fingerprint
      });
      expect(passwordChange.response.ok, JSON.stringify(passwordChange.body)).toBeTruthy();
      expect(passwordChange.body[0].status).toBe('completed');
      expect(Number(passwordChange.body[0].legacy_user_id)).toBe(legacyUserId);
      expect(passwordChange.body[0].must_change_password).toBe(false);

      const linkedProfile = await jsonFetch(`${localUrl}/rest/v1/profiles?select=legacy_user_id,must_change_password&id=eq.${encodeURIComponent(authUserId)}`, {
        headers: serviceHeaders()
      });
      expect(linkedProfile.response.ok, JSON.stringify(linkedProfile.body)).toBeTruthy();
      expect(linkedProfile.body).toEqual([{ legacy_user_id: legacyUserId, must_change_password: false }]);

      const linkedLegacy = await jsonFetch(`${localUrl}/rest/v1/ph_app_users?select=id,password,must_change_password&username=eq.${encodeURIComponent(username)}`, {
        headers: serviceHeaders()
      });
      expect(linkedLegacy.response.ok, JSON.stringify(linkedLegacy.body)).toBeTruthy();
      expect(linkedLegacy.body).toEqual([{ id: legacyUserId, password: nextPassword, must_change_password: false }]);

      const signedIn = await jsonFetch(`${localUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: nextPassword })
      });
      expect(signedIn.response.ok, JSON.stringify(signedIn.body)).toBeTruthy();
      // The isolated legacy fixture must not make this password-bearing table
      // readable by either an anonymous client or the linked native user.
      for (const authorization of [anonKey, signedIn.body.access_token]) {
        const deniedLegacy = await jsonFetch(`${localUrl}/rest/v1/ph_app_users?select=password&id=eq.${legacyUserId}`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${authorization}` }
        });
        expect(deniedLegacy.response.ok).toBeFalsy();
        expect(deniedLegacy.body.code).toBe('42501');
      }
      const oldPasswordSignIn = await jsonFetch(`${localUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: starterPassword })
      });
      expect(oldPasswordSignIn.response.ok).toBeFalsy();
      expect(oldPasswordSignIn.response.status).toBe(400);
      expect(oldPasswordSignIn.body.error_code || oldPasswordSignIn.body.code).toBe('invalid_credentials');
    } finally {
      if (legacyUserId > 0) {
        await jsonFetch(`${localUrl}/rest/v1/ph_app_users?id=eq.${legacyUserId}`, {
          method: 'DELETE',
          headers: serviceHeaders()
        });
      }
      if (authUserId) {
        await jsonFetch(`${localUrl}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
          method: 'DELETE',
          headers: serviceHeaders()
        });
      }
    }
  });

  test('reserves a forced starter-password attempt before native identity exists', async () => {
    const suffix = `${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const username = `deferred_reset_${suffix}`;
    const email = `${username}@greenleafnursery.com`;
    const nextPassword = 'Deferred-Auth-2026!';
    const fingerprint = 'b'.repeat(64);
    let authUserId = '';
    let legacyUserId = 0;

    try {
      const legacy = await jsonFetch(`${localUrl}/rest/v1/ph_app_users`, {
        method: 'POST',
        headers: { ...serviceHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({ username, password: '1234', role: 'Manager', must_change_password: false })
      });
      expect(legacy.response.ok, JSON.stringify(legacy.body)).toBeTruthy();
      legacyUserId = Number(legacy.body[0].id);

      const first = await serviceRpc('prepare_password_change_profile', {
        p_username: username,
        p_auth_user_id: null,
        p_password_fingerprint: fingerprint
      });
      expect(first.response.ok, JSON.stringify(first.body)).toBeTruthy();
      expect(first.body[0].status).toBe('needs_native_identity');
      expect(first.body[0].attempt_id).toBeTruthy();

      const created = await jsonFetch(`${localUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: serviceHeaders(),
        body: JSON.stringify({
          email,
          password: '1234',
          email_confirm: true,
          app_metadata: { legacy_user_id: String(legacyUserId) }
        })
      });
      expect(created.response.ok, JSON.stringify(created.body)).toBeTruthy();
      authUserId = created.body.id;

      const ready = await serviceRpc('prepare_password_change_profile', {
        p_username: '',
        p_auth_user_id: authUserId,
        p_password_fingerprint: fingerprint
      });
      expect(ready.response.ok, JSON.stringify(ready.body)).toBeTruthy();
      expect(ready.body[0].status).toBe('ready');
      expect(ready.body[0].attempt_id).toBe(first.body[0].attempt_id);
      expect(Number(ready.body[0].legacy_user_id)).toBe(legacyUserId);

      const authUpdate = await jsonFetch(`${localUrl}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
        method: 'PUT',
        headers: serviceHeaders(),
        body: JSON.stringify({ password: nextPassword })
      });
      expect(authUpdate.response.ok, JSON.stringify(authUpdate.body)).toBeTruthy();
      const completed = await serviceRpc('complete_password_change_profile', {
        p_attempt_id: ready.body[0].attempt_id,
        p_auth_user_id: authUserId,
        p_password: nextPassword,
        p_password_fingerprint: fingerprint
      });
      expect(completed.response.ok, JSON.stringify(completed.body)).toBeTruthy();
      expect(completed.body[0].status).toBe('completed');
      expect(completed.body[0].role).toBe('Manager');

      const signedIn = await jsonFetch(`${localUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: nextPassword })
      });
      expect(signedIn.response.ok, JSON.stringify(signedIn.body)).toBeTruthy();
    } finally {
      if (legacyUserId > 0) {
        await jsonFetch(`${localUrl}/rest/v1/ph_app_users?id=eq.${legacyUserId}`, { method: 'DELETE', headers: serviceHeaders() });
      }
      if (authUserId) {
        await jsonFetch(`${localUrl}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, { method: 'DELETE', headers: serviceHeaders() });
      }
    }
  });
});
