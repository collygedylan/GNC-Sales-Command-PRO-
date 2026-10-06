import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const hosted = await readFile(new URL('../staging/browser/staging-hosted-auth.e2e.spec.ts', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../scripts/staging/adapter.mjs', import.meta.url), 'utf8');
const seed = await readFile(new URL('../supabase/staging/teardown-schema.sql', import.meta.url), 'utf8');

test('hosted auth selectors refer to the real app DOM and drive navigation control', () => {
  const ids = [...hosted.matchAll(/page\.locator\(['"]#([A-Za-z][\w-]*)/g)].map((match) => match[1]);
  for (const id of new Set(ids)) {
    if (id === 'gnc-staging-banner') {
      assert.match(adapter, /gnc-staging-banner/);
      continue;
    }
    assert.match(app, new RegExp(`\\bid=["']${id}["']`), `hosted test references missing #${id}`);
  }
  assert.ok(hosted.includes("#bottom-nav [data-footer-view=\"drive\"]"));
  assert.doesNotMatch(hosted, /#footer-drive-btn/);
  assert.ok(app.includes('data-footer-view="drive"') && app.includes('aria-label="Drive Mode"'));
  assert.match(app, /'Open drive row'/);
  assert.match(app, /id="drawer-logout-btn"/);
  assert.match(app, /id="footer-menu-btn"/);
  assert.ok(app.includes('id="camera-btn-ssn"'));
  assert.ok(app.includes("onchange=\"handlePhotoUpload(this, 'ssn-')\""));
  assert.ok(app.includes('Retry photo'));
  assert.ok(app.includes('id="ssn-photo-list-container"'));
});

test('synthetic inventory seed exposes the current season detail editor used by hosted checks', () => {
  assert.match(app, /const PICK_NOTE_CURRENT_SEASON_CODE = 'F1'/);
  assert.match(app, /const PICK_NOTE_CURRENT_SALESYEAR_CODE = 27/);
  assert.match(app, /rowSeason === currentSeason[\s\S]{0,150}rowSalesYear <= currentSalesYear/);
  assert.ok(app.includes("if (assignment === 'season' && isCurrentSeasonSalesNotesRow(item)) document.getElementById('dtab-season').classList.remove('hidden');"));
  assert.ok(seed.includes('"season":"F1","saleyear":"27","salesyear":"27","app_tab_assignment":"season"'));
  assert.ok(seed.includes('on conflict (collection,id) do nothing;'));
  assert.match(seed, /update teardown\.rows\s+set data = data \|\| jsonb_build_object\('app_tab_assignment','season'\),\s+revision = revision \+ 1,\s+updated_at = clock_timestamp\(\)\s+where collection = 'inventory'\s+and id = 'staging-inventory-001'\s+and coalesce\(data->>'app_tab_assignment', data->>'APP_TAB_ASSIGNMENT', ''\) = '';/);
  assert.match(hosted, /#dtab-season/);
  assert.match(hosted, /#ssn-spec/);
  assert.match(hosted, /#ssn-comments/);
});
