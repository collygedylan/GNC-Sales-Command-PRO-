import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleLiveRuntime, assertLiveRuntimeOutputSize, loadLiveRuntimeManifest, validateLiveRuntimeManifest } from '../scripts/live-runtime-manifest.mjs';

const base = modules => ({ schemaVersion: 'gnc-live-runtime-modules-v1', legacyRuntimePosition: 'after-modules', modules });

test('checked-in runtime manifest preserves the legacy runtime until bounded modules are extracted', async () => {
  const validated = await loadLiveRuntimeManifest();
  assert.deepEqual(validated.modules, []);
  assert.equal(assembleLiveRuntime('legacy();', validated), 'legacy();');
});

test('runtime manifest accepts ordered dependencies and declared globals', async () => {
  const sources = new Map([
    ['live-src/modules/format.js', '(function(){ window.GncFormat = {}; })();'],
    ['live-src/modules/card.js', '(function(){ globalThis.GncCard = {}; })();'],
  ]);
  const validated = await validateLiveRuntimeManifest(base([
    { id: 'format', source: 'live-src/modules/format.js', dependencies: [], globals: ['GncFormat'] },
    { id: 'card', source: 'live-src/modules/card.js', dependencies: ['format'], globals: ['GncCard'] },
  ]), { readSource: source => sources.get(source) });
  assert.match(assembleLiveRuntime('legacy();', validated), /gnc-module:format[\s\S]*gnc-module:card[\s\S]*gnc-module:legacy-inline-runtime/);
});

test('runtime manifest rejects duplicate ids, later dependencies, and undeclared globals', async () => {
  const readSource = async source => source.endsWith('/unsafe.js')
    ? '(function(){ window.Unexpected = true; })();'
    : '(function(){})();';
  await assert.rejects(() => validateLiveRuntimeManifest(base([
    { id: 'same', source: 'live-src/modules/same.js', dependencies: [], globals: [] },
    { id: 'same', source: 'live-src/modules/other.js', dependencies: [], globals: [] },
  ]), { readSource }), /duplicate module id same/);
  await assert.rejects(() => validateLiveRuntimeManifest(base([
    { id: 'first', source: 'live-src/modules/first.js', dependencies: ['later'], globals: [] },
    { id: 'later', source: 'live-src/modules/later.js', dependencies: [], globals: [] },
  ]), { readSource }), /missing or later module later/);
  await assert.rejects(() => validateLiveRuntimeManifest(base([
    { id: 'unsafe', source: 'live-src/modules/unsafe.js', dependencies: [], globals: [] },
  ]), { readSource }), /assigns undeclared global Unexpected/);
  await assert.rejects(() => validateLiveRuntimeManifest(base([
    { id: 'bracket-unsafe', source: 'live-src/modules/bracket-unsafe.js', dependencies: [], globals: [] },
  ]), { readSource: async () => '(function(){ window["BracketUnexpected"] = true; })();' }), /assigns undeclared global BracketUnexpected/);
  await assert.rejects(() => validateLiveRuntimeManifest(base([
    { id: 'assign-unsafe', source: 'live-src/modules/assign-unsafe.js', dependencies: [], globals: [] },
  ]), { readSource: async () => '(function(){ Object.assign(window, { Undeclared: true }); })();' }), /passes the global object to a call/);
  await assert.rejects(() => validateLiveRuntimeManifest(base([
    { id: 'computed-unsafe', source: 'live-src/modules/computed-unsafe.js', dependencies: [], globals: [] },
  ]), { readSource: async () => '(function(){ window[getName()] = true; })();' }), /uses a dynamic global assignment/);
  await assert.rejects(() => validateLiveRuntimeManifest(base([
    { id: 'alias-unsafe', source: 'live-src/modules/alias-unsafe.js', dependencies: [], globals: [] },
  ]), { readSource: async () => '(function(){ const alias = window.self; alias.Undeclared = true; })();' }), /aliases the global object/);
  await assert.rejects(() => validateLiveRuntimeManifest(base([
    { id: 'nested-unsafe', source: 'live-src/modules/nested-unsafe.js', dependencies: [], globals: [] },
  ]), { readSource: async () => '(function(){ window.self.Undeclared = true; })();' }), /assigns undeclared global Undeclared/);
  for (const alias of ['top', 'parent', 'frames']) {
    await assert.rejects(() => validateLiveRuntimeManifest(base([
      { id: `${alias}-unsafe`, source: `live-src/modules/${alias}-unsafe.js`, dependencies: [], globals: [] },
    ]), { readSource: async () => `(function(){ ${alias}.Undeclared = true; })();` }), /assigns undeclared global Undeclared/);
  }
  await assert.rejects(() => validateLiveRuntimeManifest(base([
    { id: 'missing', source: 'live-src/modules/missing.js', dependencies: [], globals: [] },
  ]), { readSource: async () => undefined }), /missing or empty source for missing/);
});

test('runtime output size guard rejects unexpectedly small and large bundles', () => {
  assert.doesNotThrow(() => assertLiveRuntimeOutputSize('x'.repeat(500_000)));
  assert.throws(() => assertLiveRuntimeOutputSize('x'.repeat(499_999)), /unexpectedly small/);
  assert.throws(() => assertLiveRuntimeOutputSize('x'.repeat(10_000_001)), /unexpectedly large/);
  assert.throws(() => assertLiveRuntimeOutputSize('é'.repeat(5_000_001)), /unexpectedly large/);
});
