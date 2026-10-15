import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/customer-mapping-live-events.js', import.meta.url), 'utf8');

function api() {
  const context = { CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } } };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.GncCustomerMappingLiveEvents;
}

test('mapping revision events require the current authorized manager surface and a valid server revision', () => {
  const events = api();
  const received = [];
  const root = { isConnected: true, dispatchEvent(event) { received.push(event); return true; } };
  const current = { authorized: true, visible: true, view: 'managers', tab: 'customer-rep-map', revision: '42' };
  assert.equal(events.dispatch(root, current), true);
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'mapping-revision');
  assert.equal(received[0].detail.revision, '42');
  for (const denied of [
    { ...current, authorized: false }, { ...current, visible: false },
    { ...current, view: 'request' }, { ...current, tab: 'sales-reps' },
    { ...current, revision: 'not-a-revision' }
  ]) assert.equal(events.dispatch(root, denied), false);
  assert.equal(events.dispatch({ ...root, isConnected: false }, current), false);
  assert.equal(received.length, 1, 'denied or stale contexts do not dispatch');
});
