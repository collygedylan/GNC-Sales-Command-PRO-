import assert from 'node:assert/strict';

export function sharePasskeyContract(runFunctions,read,functionSource) {
  const reclass = runFunctions('Code.gs', ['buildReclassInlineOhText_']);
  assert.equal(reclass.buildReclassInlineOhText_('152', [{ quantity: 140, destinationSeason: 'f1' }]), '152 - 140 --> F1');
  assert.equal(reclass.buildReclassInlineOhText_('152', [
    { quantity: 100, destinationSeason: 'f1' }, { quantity: 40, destinationSeason: 's1' }
  ]), '152 - 100 --> F1, - 40 --> S1');

  const runtime = read('assets/app-runtime.js');
  assert.match(runtime, /buildInventoryShareGalleryUrl[^]*url\.searchParams\.set\('gallery', '1'\)[^]*url\.searchParams\.set\('p', photoKeys\.join\(','\)\)/);
  assert.match(runtime, /Photos: \$\{inventoryPhotos\.length\} photo/);
  assert.match(functionSource('assets/app-runtime.js','formatInventoryItemsHtml'), /inventoryPhotos\.map[^]*buildSharePhotoHtml/);
  const inventoryFormatter = runtime.slice(runtime.indexOf('function formatInventoryItemsText('), runtime.indexOf('function formatInventoryItemsHtml('));
  assert.doesNotMatch(inventoryFormatter, /Photo \$\{photoIndex \+ 1\}|photo\.url|photo\.href/);
  assert.match(runtime, /LAST_PASSKEY_USERNAME_STORAGE_KEY[^]*invalidateNativeAuthRecovery\(\)[^]*auth\.signInWithPasskey\(\)/);

  const edge = read('supabase/functions/app-api/index.ts');
  assert.match(edge, /passkey_auth_options[^]*passkeys\/authentication\/options/);
  assert.match(edge, /passkeys\/authentication\/verify/);
  assert.match(edge, /passkey_login_verify/);
  assert.match(edge, /options\.allowCredentials = \[\]/);
  const appsScriptPatch = read('scripts/apps-script-function-patch.mjs');
  assert.match(appsScriptPatch, /reclassEmailFunctions[^]*buildReclassInlineOhText_/);
  assert.match(appsScriptPatch, /additiveFunctions[^]*buildReclassInlineOhText_/);
  const migration = read('supabase/migrations/20261027143000_agdata_v2385_reclass_open_stock_and_inline_oh.sql');
  assert.match(migration, /replace\(definition,\s*'next_stock:=coalesce\(baseline,0\)\+change\.delta;',\s*'next_stock:=coalesce\(baseline,0\)\+change\.oh_delta;'\)/);
  assert.match(migration, /private\.reclass_numeric_v1\(m\.s_lts\)\+change\.oh_delta/);
}
