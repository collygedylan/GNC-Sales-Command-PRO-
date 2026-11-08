// @test-group: requests
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';

const client = readFileSync(new URL('../src/ui/ops-pilot-layout.js', import.meta.url), 'utf8');
const functionSource = name => {
  const start = client.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const node = parseExpressionAt(client, start, { ecmaVersion: 'latest' });
  return client.slice(node.start, node.end);
};

test('viewport health reads geometry before writes and leaves unchanged styles untouched', () => {
  const values = new Map(), operations = [];
  const nav = { dataset: {}, getBoundingClientRect() { operations.push('read-nav'); return { height: 80 }; } };
  const main = { getBoundingClientRect() { operations.push('read-main'); return { top: 100 }; } };
  const root = { clientHeight:800, style: { getPropertyValue: key => values.get(key) || '',
    setProperty(key,value) { operations.push('write'); values.set(key,value); } } };
  const context = vm.createContext({ window: { innerHeight:800 }, document: { documentElement:root, body:{},
    getElementById:id => id==='bottom-nav'?nav:main }, getComputedStyle:()=>({display:'flex'}), getEffectiveTheme:()=> 'dark' });
  vm.runInContext(functionSource('measureRuntimeViewport'), context);
  context.measureRuntimeViewport();
  assert.deepEqual(operations.slice(0,2), ['read-nav','read-main']);
  assert.equal(values.get('--ops-content-available-height'), '620px');
  operations.length=0;
  context.measureRuntimeViewport();
  assert.deepEqual(operations, ['read-nav','read-main']);
});

test('layout assertions wait for input to settle while viewport measurements remain responsive', async () => {
  let typing=true, measurements=0, scans=0, next;
  const context=vm.createContext({ shared:{layoutHealthTimer:0,healthRetryInFlight:false,state:{activeView:'detail'}},
    measureRuntimeViewport:()=>measurements++, captureHomeLayoutHealth:()=>{}, captureChatLayoutHealth:()=>{}, window:{isUserActivelyTyping:()=>typing},
    document:{getElementById:()=>null,querySelectorAll:()=>{scans++;return[];}},
    setTimeout:fn=>{next=fn;return 1;} });
  const waitStart = client.indexOf('async function waitForPilotIdle(');
  const waitNode = parseExpressionAt(client, waitStart, { ecmaVersion:'latest' });
  vm.runInContext(functionSource('pilotInteractionActive') + client.slice(waitNode.start,waitNode.end) + functionSource('runLayoutHealthAssertions'),context);
  context.runLayoutHealthAssertions();
  assert.equal(measurements,1); assert.equal(scans,0); assert.equal(typeof next,'function');
  typing=false; next(); await new Promise(setImmediate);
  assert.equal(measurements,2); assert.equal(scans,1);
});
