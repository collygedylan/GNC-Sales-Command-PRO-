// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = name => {
  const match = html.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?^        }', 'm'));
  assert.ok(match, name); return match[0];
};

test('Managers uses authenticated settings API and changes local state only after server success', async () => {
  let finish; const writes = []; const requests = [];
  const f = vm.createContext({
    startGlobalProgress() {}, stopGlobalProgress() {}, appSeasonSettingsRemoteLoaded: false,
    callManagerSeasonSettings: payload => { requests.push(payload); return new Promise(resolve => { finish = resolve; }); },
    writeLocalAppSeasonSettings: value => writes.push(value),
  });
  vm.runInContext(source('saveCurrentSeasonSettingsToRemote'), f);
  const pending = f.saveCurrentSeasonSettingsToRemote({ seasonCode: 'F1', salesYear: 28, revision: 3 });
  assert.equal(writes.length, 0);
  assert.equal(requests[0].expectedRevision, 3);
  const saved = { seasonCode: 'F1', salesYear: 28, revision: 4, updatedBy: 'dylan_collyge', updatedAt: '2026-10-07' };
  finish(saved); await pending;
  assert.deepEqual(writes, [saved]); assert.equal(f.appSeasonSettingsRemoteLoaded, true);
  f.callManagerSeasonSettings = async () => { throw Error('SEASON_SETTINGS_CONFLICT'); };
  await assert.rejects(f.saveCurrentSeasonSettingsToRemote({ seasonCode: 'S1', salesYear: 27, revision: 3 }), /CONFLICT/);
  assert.equal(writes.length, 1, 'conflicts must not change local active season');
  assert.doesNotMatch(source('saveCurrentSeasonSettingsToRemote'), /SUPABASE_KEY|rest\/v1|updatedBy:|new Date/);
  assert.match(source('callManagerSeasonSettings'), /getNativeAuthRequestHeaders/);
});

test('Managers rejects a response after the authenticated identity changes', async () => {
  let identity = 'dylan';
  const f = vm.createContext({
    APP_API_FUNCTION_URL: 'https://fixture.invalid', APP_CURRENT_SEASON_OPTIONS: ['S1', 'F1'],
    getSupabaseReadIdentityScope: () => identity,
    getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer fixture' }),
    postAppFunctionJson: async () => { identity = 'different-user'; return { ok: true, data: { seasonCode: 'S1', salesYear: 27, revision: 1 } }; },
  });
  vm.runInContext(source('callManagerSeasonSettings'), f);
  await assert.rejects(f.callManagerSeasonSettings({ operation: 'read' }), /session changed/);
});

test('Leaf holds Aura audio ownership through recording, pending submission and playback', () => {
  const events = [];
  const f = vm.createContext({
    leafVoiceListening: false, leafVoiceRecognition: null, leafVoiceSubmitPending: false,
    leafVoiceFinalizeTimer: null, leafAssistantBusy: false, leafVoiceSpeaking: false, leafVoiceUtterance: null,
    window: { GncAuraAudio: { claim: name => events.push('claim:' + name), release: name => events.push('release:' + name) } },
  });
  vm.runInContext(source('syncLeafAuraAudioOwnership'), f);
  f.leafVoiceListening = true; f.syncLeafAuraAudioOwnership();
  f.leafVoiceListening = false; f.leafVoiceSubmitPending = true; f.syncLeafAuraAudioOwnership();
  f.leafVoiceSubmitPending = false; f.leafVoiceUtterance = {}; f.syncLeafAuraAudioOwnership();
  f.leafVoiceUtterance = null; f.syncLeafAuraAudioOwnership();
  assert.deepEqual(events, ['claim:leaf', 'claim:leaf', 'claim:leaf', 'release:leaf']);
});

test('Aura settings use widget device preference API and mount with the verified Auth ID', () => {
  assert.match(source('toggleAuraHandsFreeAutoStart'), /setHandsFreeAutoStart/);
  assert.match(source('syncAuraWidgetForSession'), /userId: session\.user\.id/);
  assert.doesNotMatch(source('syncAuraWidgetForSession'), /startIfAllowed/);
  assert.match(html, /preloadAuraVoiceWidget\(\);/);
});
