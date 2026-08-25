import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Kayla has Request-row archive authority', () => {
  assert.match(html, /const REQUEST_GLOBAL_ACCESS_TOKENS = new Set\(\['kayla_knepp'/);
  assert.match(html, /const REQUEST_ROW_ARCHIVE_USERS = new Set\(\['kayla_knepp'/);
  const permissionCode = html.slice(
    html.indexOf('function canCurrentUserArchiveRequestRows'),
    html.indexOf('function canCurrentUserArchiveRequestRow(item')
  );
  assert.match(permissionCode, /REQUEST_ROW_ARCHIVE_USERS\.has\(token\)/);
});

test('iOS Request rendering uses the swipe surface instead of disabling it', () => {
  const decorateCode = html.slice(
    html.indexOf('function decorateRequestRows'),
    html.indexOf('function refreshRequestViewAfterArchive')
  );
  assert.match(decorateCode, /request-swipe-enabled/);
  assert.doesNotMatch(decorateCode, /decorateIosPhoneRequestRemoveButtons\(container\)/);
  assert.doesNotMatch(decorateCode, /request-swipe-disabled/);
  assert.match(decorateCode, /touchend', handleRequestSwipeTouchEnd, \{ passive: false \}/);
  assert.match(decorateCode, /pointerup', handleRequestSwipeEnd, \{ passive: false \}/);
});

test('iOS Request swipe reveals a touch-sized Remove action', () => {
  assert.match(html, /body\.ios-device\.viewport-phone\.current-view-request #view-request \.request-swipe-row\{[\s\S]*overflow:hidden !important/);
  assert.match(html, /body\.ios-device\.viewport-phone\.current-view-request #view-request \.request-swipe-row\.swipe-open \.request-swipe-surface\{[\s\S]*translateX\(-88px\)/);
  assert.match(html, /body\.ios-device\.viewport-phone\.current-view-request #view-request \.request-swipe-action\{[\s\S]*display:flex !important[\s\S]*width:88px !important[\s\S]*min-height:44px !important/);
});
