// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import { auraPcmWave, createAuraGeminiSpeech } from '../services/auraGeminiSpeech.js';
test('Gemini PCM receives a valid mono 24kHz WAV header without dropping samples', () => {
  const result = auraPcmWave('AAAAAA=='), view = new DataView(result);
  assert.equal(result.byteLength, 48); assert.equal(view.getUint32(24, true), 24000); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 4); assert.deepEqual([...new Uint8Array(result, 44)], [0, 0, 0, 0]);
  assert.throws(() => auraPcmWave('AA=='), /invalid/);
});
test('speech sends only conversation identity and cancels stale audio on account changes', async () => {
  const calls = [], claims = [];
  let current = true, resolve;
  const player = createAuraGeminiSpeech({ request: async body => { calls.push(body); return new Promise(done => { resolve = done; }); },
    isCurrent: () => current, claimAudio: owner => { claims.push(owner); return () => claims.push('released'); },
    getAudioContext: () => { throw new Error('Stale audio must not play'); } });
  const pending = player.speak({ conversationId: 'private-chat', turnId: 'verified-turn' });
  current = false; player.destroy(); resolve({ ok: true, audio: { mimeType: 'audio/L16;codec=pcm;rate=24000', base64: 'AAAAAA==' } });
  assert.equal(await pending, false); assert.deepEqual(calls, [{ mode: 'speech', conversationId: 'private-chat', turnId: 'verified-turn' }]);
  assert.deepEqual(claims, ['aura-gemini-speech', 'released']);
});
