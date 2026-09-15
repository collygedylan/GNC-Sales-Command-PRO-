import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function source(name) {
  let start = html.indexOf(`        function ${name}(`);
  if (start < 0) start = html.indexOf(`        async function ${name}(`);
  const end = html.indexOf('\n        }', start);
  assert.ok(start >= 0 && end > start, name);
  return html.slice(start, end + 10);
}
function runtime() {
  const c = vm.createContext({});
  const names = ['firstNonEmptyValue', 'parsePhotoCsvValues', 'mergePhotoCsvList', 'getLocPhotoOwnedValue',
    'normalizeFlyerShadowFields', 'getSharedAppPhotoName', 'normalizeRowPhotoFields', 'clonePhotoFields',
    'appendPhotoCsvValue', 'applySharedPhotoFieldsToItem', 'sortPhotoCsvPairByCaptureOrder',
    'getPhotoCaptureOrderKey', 'getPhotoCaptureOrderParts', 'decodePhotoOrderText',
    'getPhotoAliasFieldsForPrefix', 'setPhotoAliasFieldsForPrefix'];
  vm.runInContext(names.map(source).join('\n'), c);
  return c;
}
test('exact photo synchronization preserves multiple additions against stale target aliases', () => {
  const c = runtime();
  const source = { PHOTO_LINK: null, PHOTO_NAME: null };
  c.normalizeRowPhotoFields(source);
  c.applySharedPhotoFieldsToItem(source, 'https://example.test/one.webp', 'one.webp');
  c.applySharedPhotoFieldsToItem(source, 'https://example.test/two.webp', 'two.webp');
  const target = { PHOTO_LINK: null, photo_link: null, PHOTO_NAME: null };
  c.clonePhotoFields(source, target, { exact: true });
  assert.equal(target.SAVED_PHOTO_LINK, 'https://example.test/one.webp,https://example.test/two.webp');
  assert.equal(target.photo_link, target.PHOTO_LINK);
  assert.equal(target.SAVED_PHOTO_NAME, 'one.webp,two.webp');
});
test('an authoritative source clear still removes stale aliases', () => {
  const c = runtime();
  const source = { PHOTO_LINK: null, PHOTO_NAME: null, SAVED_PHOTO_LINK: 'https://example.test/stale.webp' };
  const target = { PHOTO_LINK: 'https://example.test/old.webp', PHOTO_NAME: 'old.webp' };
  c.clonePhotoFields(source, target, { exact: true });
  assert.equal(target.PHOTO_LINK, '');
  assert.equal(target.SAVED_PHOTO_LINK, '');
});

test('upload authorization finishing after an account change cannot send a file', async () => {
  let resolveHeaders;
  let current = true;
  let writes = 0;
  const c = vm.createContext({ SUPABASE_KEY: 'isolated-public-key', SUPABASE_UPLOAD_TIMEOUT_MS: 1000,
    getNativeAuthRequestHeaders: () => new Promise(resolve => { resolveHeaders = resolve; }),
    getCurrentAppSessionToken: () => '', fetchWithTimeout: () => { writes++; throw new Error('unexpected write'); } });
  vm.runInContext(source('postAppFunctionFormData'), c);
  const pending = c.postAppFunctionFormData('https://isolated.test/upload', {}, { isCurrent: () => current });
  current = false;
  resolveHeaders({ Authorization: 'Bearer different-account' });
  await assert.rejects(pending, { code: 'REQUEST_ABORTED' });
  assert.equal(writes, 0);
});
