import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

function pilotWindow() {
  const dom = new JSDOM('<!doctype html><html><body><div id="view-wrapper"></div></body></html>',
    { url:'https://example.test/', runScripts:'outside-only', pretendToBeVisual:true });
  dom.window.eval(readFileSync(new URL('../assets/ops-precision-pilot.js',import.meta.url),'utf8'));
  return dom;
}

test('pilot bundle preserves private initialization, user-scoped appearance and failure fallback', async () => {
  const dom = pilotWindow();
  try {
    const pilot = dom.window.__gncOpsPilot;
    assert.ok(pilot);
    assert.equal(await pilot.initialize({}),false);
    const bridge = { getUserKey:()=> 'actor-a', getActiveView:()=> 'drive', request:async()=>({
      ok:true, eligible:true, flags:{skin:true,preferences:true,card_grid:true},
      preferences:{themeMode:'dark',displayMode:'cards',updatedAt:'2026-01-01T00:00:00Z'}
    }) };
    assert.equal(await pilot.initialize(bridge),true);
    const state=pilot.getState();
    assert.equal(state.userKey,'actor_a');
    assert.equal(state.activeView,'drive');
    assert.equal(state.preferences.themeMode,'dark');
    assert.equal(dom.window.document.body.classList.contains('ops-pilot-active'),true);
    assert.equal(await pilot.initialize({getUserKey:()=> 'actor-b',request:async()=>({ok:false})}),false);
    assert.equal(pilot.getState().eligible,false);
  } finally { dom.window.close(); }
});

