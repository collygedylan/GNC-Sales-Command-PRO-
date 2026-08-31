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

test.describe('Native Auth profile-link provisioning', () => {
  test.skip(!localUrl || !anonKey || !serviceKey, 'Local Supabase environment is required.');

  test('repairs an orphan profile and keeps password changes synchronized', async () => {
    const suffix = `${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const username = `auth_link_${suffix}`;
    const email = `${username}@example.com`;
    const starterPassword = 'Starter-Auth-2026!';
    const nextPassword = 'Linked-Auth-2026!';
    let authUserId = '';
    let legacyUserId = 0;

    try {
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
          role: 'User',
          division: '10',
          language: 'English',
          must_change_password: true
        })
      });
      expect(orphanProfile.response.ok, JSON.stringify(orphanProfile.body)).toBeTruthy();
      expect(orphanProfile.body[0].legacy_user_id).toBeNull();

      const repaired = await serviceRpc('provision_native_auth_app_user', {
        p_auth_user_id: authUserId,
        p_username: username,
        p_password: starterPassword,
        p_display_name: username,
        p_role: 'User',
        p_division: '10',
        p_language: 'English',
        p_must_change_password: true
      });
      expect(repaired.response.ok, JSON.stringify(repaired.body)).toBeTruthy();
      legacyUserId = Number(repaired.body[0].legacy_user_id);
      expect(legacyUserId).toBeGreaterThan(0);

      const passwordChange = await serviceRpc('provision_native_auth_app_user', {
        p_auth_user_id: authUserId,
        p_username: username,
        p_password: nextPassword,
        p_display_name: username,
        p_role: 'User',
        p_division: '10',
        p_language: 'English',
        p_must_change_password: false
      });
      expect(passwordChange.response.ok, JSON.stringify(passwordChange.body)).toBeTruthy();
      expect(Number(passwordChange.body[0].legacy_user_id)).toBe(legacyUserId);

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
});
