import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = readComposedAppSource();
const auth = html.slice(html.indexOf('        function isAuraProfileCandidate()'), html.indexOf('        function disposeAuraWidget()'));
test('AURA controls require canonical Dylan identity and the server-verified per-account flag', () => {
  const routerAuth = auth.slice(auth.indexOf('function isAuraRouterProfileCandidate()'));
  assert.match(routerAuth, /username === 'dylan_collyge'/);
  assert.match(routerAuth, /currentUser \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'dylan_collyge'/);
  for (const username of ['dylan_collyge', 'jd_jones', 'megan_kelly', 'rep_one']) for (const auraEnabled of [undefined, false, 'true', true]) {
    const context = vm.createContext({ nativeAuthSessionActive: true,
      nativeAuthProfile: { id: 'actor', username, role: 'REP' }, currentUser: username,
      window: { GncUserAccessControl: { isAuraOwner: value => String(value).trim().toLowerCase() === 'dylan_collyge' } },
      auraRouterVerifiedProfileId: 'actor', auraVerifiedProfileId: 'actor',
      auraRouterCapabilities: { id: 'actor', username, role: 'REP', auraEnabled } });
    vm.runInContext(auth, context);
    assert.equal(context.isAuraRouterWidgetAuthorized(), username === 'dylan_collyge' && auraEnabled === true);
    assert.equal(context.isAuraWidgetAuthorized(), auraEnabled === true && username === 'dylan_collyge');
    context.auraRouterVerifiedProfileId = 'another-user';
    assert.equal(context.isAuraRouterWidgetAuthorized(), false);
  }
});
test('rollout seed and future updates are server-managed and fail on ambiguous owner identity', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261012153000_aura_account_rollout.sql', import.meta.url), 'utf8');
  assert.match(sql, /references public\.profiles\(id\) on delete cascade/);
  assert.match(sql, /revoke all on private\.aura_account_rollout from public,anon,authenticated/);
  assert.match(sql, /AURA_ROLLOUT_OWNER_AMBIGUOUS/);
  assert.ok(sql.indexOf('insert into private.aura_account_rollout') < sql.indexOf('force row level security'));
  assert.match(sql, /where lower\(btrim\(username\)\)='dylan_collyge'/);
  assert.match(sql, /r\.profile_id=actor_id and r\.enabled/);
});
