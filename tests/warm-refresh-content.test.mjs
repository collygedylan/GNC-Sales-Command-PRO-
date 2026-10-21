import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();

function functionSource(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const tail = html.slice(start);
  const end = tail.indexOf('\n        function ', 20);
  assert.ok(end >= 0, `Missing next function after ${name}`);
  return tail.slice(0, end + 9);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('weather refresh keeps warm content until forced refresh settles and retains cold skeleton', async () => {
  const gate = deferred();
  const writes = [];
  const c = vm.createContext({
    weatherHoldState: { loaded: true, error: '', riskLoaded: true, riskError: '' },
    document: { getElementById: () => ({ innerHTML: 'warm-weather-markup' }) },
    setContainerHtml: (_container, markup) => writes.push(markup),
    loadWeatherHoldData: (force) => { assert.equal(force, true); return gate.promise; },
    isViewVisible: () => false,
  });
  vm.runInContext(functionSource('reloadWeatherHoldData'), c);
  c.reloadWeatherHoldData();
  assert.equal(c.weatherHoldState.loaded, true);
  assert.equal(c.weatherHoldState.riskLoaded, false);
  assert.deepEqual(writes, []);
  gate.resolve();
  await gate.promise;

  const coldWrites = [];
  c.weatherHoldState.loaded = false;
  c.setContainerHtml = (_container, markup) => coldWrites.push(markup);
  c.loadWeatherHoldData = (force) => { assert.equal(force, true); return new Promise(() => {}); };
  c.reloadWeatherHoldData();
  assert.equal(c.weatherHoldState.loaded, false);
  assert.equal(coldWrites.length, 1);
  assert.match(coldWrites[0], /Refreshing weather/);
});

test('Shear refresh keeps warm content during forced refresh and retains cold skeleton', async () => {
  const gate = deferred();
  const writes = [];
  const c = vm.createContext({
    shearListState: { loaded: true, error: '' },
    document: { getElementById: () => ({ innerHTML: 'warm-shear-markup' }) },
    setContainerHtml: (_container, markup) => writes.push(markup),
    loadShearListData: (force) => { assert.equal(force, true); return gate.promise; },
    reconcileInventoryEditMockShearListRows: async () => {},
    isViewVisible: () => false,
  });
  vm.runInContext(functionSource('reloadShearListData'), c);
  c.reloadShearListData();
  assert.equal(c.shearListState.loaded, true);
  assert.deepEqual(writes, []);
  gate.resolve();
  await gate.promise;

  const coldWrites = [];
  c.shearListState.loaded = false;
  c.setContainerHtml = (_container, markup) => coldWrites.push(markup);
  c.loadShearListData = (force) => { assert.equal(force, true); return new Promise(() => {}); };
  c.reloadShearListData();
  assert.equal(c.shearListState.loaded, false);
  assert.equal(coldWrites.length, 1);
  assert.match(coldWrites[0], /Refreshing shear list/);
});
