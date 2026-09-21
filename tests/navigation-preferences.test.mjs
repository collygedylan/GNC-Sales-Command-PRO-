import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { handleNavigationPreferences, resolveModuleAllowed } from '../supabase/functions/_shared/navigation-preferences.ts';

const source = fs.readFileSync(new URL('../assets/navigation-preferences.js', import.meta.url), 'utf8');
function client(call, options = {}) {
    const context = { crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } };
    vm.runInNewContext(source, context);
    const api = context.GncNavigationPreferences;
    api.configure({ username: 'worker', call, canAccess: () => true, ...options });
    return api;
}
function snapshot(changes = {}) {
    return { username: 'worker', accessRevision: 1, footerRevision: 2, shortcuts: null,
        views: ['drive', 'tasks', 'docks', 'request', 'bloom', 'reports', 'hl-order'].map(view => ({ view, allowed: view !== 'hl-order', override: null, selectable: true })), ...changes };
}

test('shortcuts retain order, cap five, reject fixed entries, duplicates, and revoked views', () => {
    const api = client();
    assert.deepEqual(Array.from(api.normalizedShortcuts(['menu', 'docks', 'docks', 'home', 'drive', 'communication', 'reports', 'tasks', 'bloom', 'request'], view => view !== 'reports')),
        ['docks', 'drive', 'tasks', 'bloom', 'request']);
    assert.deepEqual(Array.from(api.normalizedShortcuts([])), []);
});

test('defaults use only permitted entries and a saved empty footer remains empty', async () => {
    let value = snapshot();
    const api = client(async () => ({ ok: true, data: value }), { canAccess: view => view !== 'tasks' });
    await api.refresh();
    assert.deepEqual(Array.from(api.shortcuts()), ['drive', 'docks', 'request', 'bloom']);
    value = snapshot({ shortcuts: [] }); await api.refresh();
    assert.deepEqual(Array.from(api.shortcuts()), []);
});

test('unchanged module defaults preserve the current shell while explicit grants are effective', async () => {
    const api = client(async () => snapshot({ views: [
        { view: 'drive', allowed: true, override: null },
        { view: 'tasks', allowed: true, override: true },
        { view: 'docks', allowed: false, override: false },
        { view: 'reports', allowed: true, override: null },
    ] }));
    await api.refresh();
    assert.equal(api.allowed('drive', false), false);
    assert.equal(api.allowed('tasks', false), true);
    assert.equal(api.allowed('docks', true), false);
    assert.equal(api.allowed('reports', false), true);
    assert.equal(api.allowed('unknown', false), false);
});

test('refresh is coalesced and a late response cannot leak the previous account preferences', async () => {
    let finish, count = 0, user = 'worker';
    const api = client(() => { count++; return new Promise(resolve => { finish = resolve; }); }, { username: () => user });
    const first = api.refresh(), second = api.refresh();
    assert.equal(count, 1);
    user = 'other'; api.reset(); finish(snapshot());
    await Promise.all([first, second]);
    assert.equal(api.snapshot, null);
});

test('failed refresh retains the last confirmed settings without treating failure as saved data', async () => {
    let fail = false;
    const api = client(async () => { if (fail) throw new Error('offline'); return snapshot({ shortcuts: ['docks'] }); });
    await api.refresh(); fail = true;
    await assert.rejects(api.refresh(), /offline/);
    assert.deepEqual(Array.from(api.shortcuts()), ['docks']);
});

test('API forwards only the verified actor and rejects submitted identity injection', async () => {
    const calls = [];
    const db = { rpc: async (name, payload) => { calls.push({ name, payload }); return { data: { saved: true }, error: null }; } };
    const actor = { id: 'verified-id', username: 'manager' };
    await handleNavigationPreferences(db, actor, { action: 'navigation_preferences', operation: 'save_shortcuts', payload: { shortcuts: ['drive'] }, commandId: 'command', expectedRevision: 7 });
    assert.equal(calls[0].payload.p_actor_id, 'verified-id');
    assert.equal(calls[0].payload.p_expected_revision, 7);
    await assert.rejects(handleNavigationPreferences(db, actor, { operation: 'get', actor: 'dylan_collyge' }), /PAYLOAD_INVALID/);
    await assert.rejects(handleNavigationPreferences(db, {}, { operation: 'get' }), /AUTH_REQUIRED/);
    assert.equal(calls.length, 1);
});

test('server module helper fails closed and propagates unavailable permission checks', async () => {
    assert.equal(await resolveModuleAllowed({ rpc: async () => ({ data: true, error: null }) }, {}, 'drive'), false);
    assert.equal(await resolveModuleAllowed({ rpc: async () => ({ data: 'true', error: null }) }, { id: 'id' }, 'drive'), false);
    await assert.rejects(resolveModuleAllowed({ rpc: async () => ({ data: null, error: new Error('unavailable') }) }, { id: 'id' }, 'drive'), /unavailable/);
});
