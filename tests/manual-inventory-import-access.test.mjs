import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
const gs = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const html = readComposedAppSource();
const ast = parse(gs, { ecmaVersion: 'latest' });
const code = ast.body.filter(node => node.type === 'FunctionDeclaration' && ['doPost', 'verifyManualInventoryImportActor_'].includes(node.id.name))
  .map(node => gs.slice(node.start, node.end)).join('\n');
function backend(actor) {
  const calls = [];
  const context = vm.createContext({
    verifyInventoryWorkflowActor_: () => { if (actor instanceof Error) throw actor; return actor; },
    jsonOutput_: value => value,
    cleanupRequestGalleryPropertyCache_: () => calls.push('cleanup'),
    queueManualSyncRequest_: value => { calls.push(value); return { ok: true, status: 'queued' }; },
    clearManualSyncStatus: () => calls.push('clear'),
    getManualSyncStatusForClient_: () => ({ active: false }),
    loadManualSyncStatus_: () => null,
    ContentService: { createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }), MimeType: { JSON: 'json' } },
  });
  vm.runInContext(code, context);
  return { calls, invoke: payload => context.doPost({ postData: { contents: JSON.stringify(payload) } }) };
}
test('direct manual import and recovery endpoints reject every unauthorized actor before side effects', () => {
  for (const actor of [null, { id: 'rep', username: 'rep_one' }, { id: 'admin', username: 'other_admin' }, new Error('expired-session')])
    for (const type of ['manual_run', 'manual_clear_status', 'manual_clear_stale_status']) {
      const f = backend(actor), result = f.invoke({ type, requested_by: 'dylan_collyge', requestedBy: 'jd_jones' });
      assert.equal(result.status, 403); assert.equal(result.message, 'Permission Denied');
      assert.deepEqual(f.calls, []); assert.equal(result.ok, false);
    }
});
test('both named administrators may queue imports and audit identity comes from verified Auth', () => {
  for (const username of ['dylan_collyge', 'jd_jones']) {
    const f = backend({ id: 'verified-admin', username });
    assert.equal(f.invoke({ type: 'manual_run', requested_by: 'someone_else', job: 'drive' }).ok, true);
    assert.equal(f.calls[1].requestedBy, username); assert.equal(f.calls[1].job, 'drive');
  }
});
test('manual status remains readable without starting or unlocking an import', () => {
  const f = backend(new Error('not-admin'));
  assert.equal(f.invoke({ type: 'manual_status' }).active, false);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0], 'cleanup');
});
test('Run Script visibility requires an active matching native Dylan or JD profile', () => {
  const source = html.match(/        function canRunManualInventoryImport\([^]*?^        }/m)?.[0];
  assert.ok(source);
  for (const username of ['dylan_collyge', 'jd_jones', 'rep_one', 'other_admin']) {
    const f = vm.createContext({ nativeAuthSessionActive: true, currentUser: username,
      nativeAuthProfile: { id: 'fixture', username, must_change_password: false, disabled_at: null, locked_until: null } });
    vm.runInContext(source, f);
    assert.equal(f.canRunManualInventoryImport(), ['dylan_collyge', 'jd_jones'].includes(username));
    f.nativeAuthProfile.disabled_at = '2026-10-12'; assert.equal(f.canRunManualInventoryImport(), false);
    f.nativeAuthProfile.disabled_at = null; f.nativeAuthProfile.locked_until = 'invalid'; assert.equal(f.canRunManualInventoryImport(), false);
    f.nativeAuthProfile.locked_until = null; f.nativeAuthProfile.must_change_password = true; assert.equal(f.canRunManualInventoryImport(), false);
    f.nativeAuthProfile.must_change_password = false; f.currentUser = 'another_user'; assert.equal(f.canRunManualInventoryImport(), false);
  }
});
