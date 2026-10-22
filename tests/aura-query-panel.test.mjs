// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { mountAuraQueryPanel, boundedAuraChatHistory } from '../components/common/auraQueryPanel.js';

const appRuntimeSource = readFileSync(new URL('../assets/app-runtime.js', import.meta.url), 'utf8');
function extractRuntimeFunction(name) {
  const match = appRuntimeSource.match(new RegExp(`        function ${name}\\([^]*?^        }`, 'm'));
  assert.ok(match, name);
  return match[0];
}

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(handler = async () => ({})) {
  const dom = new JSDOM('<section><div></div><input></section>');
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  const panel = document.querySelector('section'), content = panel.querySelector('div'), input = panel.querySelector('input');
  const calls = [], actions = [], busy = [], states = [];
  let authorized = true;
  const ui = mountAuraQueryPanel({ panel, content, input, isAuthorized: () => authorized,
    request: async (body, options) => { calls.push(body); return { ok: true, conversationId: 'chat-1', revision: 1, ...await handler(body, options) }; },
    speak() {}, setBusy: value => busy.push(value), onAssistantState: value => states.push(value), openAction: async action => actions.push(action),
  });
  const click = text => { const button = [...panel.querySelectorAll('button')].find(node => node.textContent === text && !node.disabled); assert.ok(button, text); button.click(); };
  return { ui, calls, actions, busy, states, panel, content, input, click, revoke() { authorized = false; },
    close() { ui.destroy(); if (prior) Object.defineProperty(globalThis, 'document', prior); else delete globalThis.document; dom.window.close(); } };
}

test('internal commands carry bounded completed history and private conversation references on follow-up', async () => {
  const f = fixture(async body => body.mode === 'command' ? { reply: 'Verified 12 available.', revision: body.expectedRevision + 1, actions: [] } : {});
  try {
    await f.ui.submit('How many roses in C.06?');
    await f.ui.submit('only Zoe’s');
    assert.deepEqual(f.calls.map(value => value.mode), ['create', 'command', 'command']);
    assert.equal(f.calls[2].conversationId, 'chat-1');
    assert.equal(f.calls[2].expectedRevision, 2);
    assert.deepEqual(f.calls[2].context, {});
    assert.equal(f.calls[2].text, 'only Zoe’s');
    assert.deepEqual(f.calls[1].history, []);
    assert.deepEqual(f.calls[2].history, [{ role: 'user', content: 'How many roses in C.06?' },
      { role: 'assistant', content: 'Verified 12 available.' }]);
    assert.equal(f.panel.querySelectorAll('.aura-chat-assistant').length, 2);
  } finally { f.close(); }
});

test('choices and pagination submit deterministic follow-ups without client-supplied entity claims', async () => {
  const f = fixture(async body => body.mode === 'command' ? {
    reply: 'Choose a plant.', hasMore: true,
    actions: [{ type: 'choices', kind: 'entity', items: [{ id: '00123', label: 'Baby Gem #3' }] }],
  } : {});
  try {
    await f.ui.submit('Where is baby jem?');
    f.click('1. Baby Gem #3'); await flush();
    assert.equal(f.calls.at(-1).text, 'option 1');
    f.click('Show more'); await flush();
    assert.equal(f.calls.at(-1).text, 'show more');
  } finally { f.close(); }
});

test('history resumes a private thread, renders HTML as text, and requires an explicit delete', async () => {
  const f = fixture(async body => {
    if (body.mode === 'list') return { conversations: [{ id: 'saved', title: 'Saved plants' }] };
    if (body.mode === 'read') return { conversationId: 'saved', revision: 8, turns: [{ text: '<script>bad()</script>', response: { reply: '12 available', actions: [
      { type: 'records', rows: [{ itemcode: '00123', owners: ['zoe_green'] }] },
      { type: 'review', view: 'drive', proposal: { text: 'Old proposal' } },
    ] } }] };
    return {};
  });
  try {
    f.click('Conversations'); await flush(); f.click('Saved plants'); await flush();
    assert.equal(f.panel.querySelectorAll('script').length, 0);
    assert.match(f.panel.textContent, /<script>bad/);
    assert.match(f.panel.textContent, /00123/);
    assert.match(f.panel.textContent, /zoe_green/);
    assert.doesNotMatch(f.panel.textContent, /Review in app|Old proposal/);
    f.click('Delete chat'); await flush();
    assert.equal(f.calls.filter(body => body.mode === 'delete').length, 0);
    f.click('Delete permanently'); await flush();
    assert.equal(f.calls.at(-1).conversationId, 'saved');
    assert.equal(f.calls.at(-1).mode, 'delete');
    assert.doesNotMatch(f.panel.textContent, /12 available/);
  } finally { f.close(); }
});

test('review actions never save and render records using text content', async () => {
  const f = fixture(async () => ({ reply: 'Review this assignment.', actions: [
    { type: 'records', rows: [{ name: '<img src=x onerror=bad()>' }], columns: ['name'] },
    { type: 'review', view: 'tasks', proposal: { text: 'Assign item 00123 to Zoe.' } },
  ] }));
  try {
    await f.ui.submit('Assign item 00123 to Zoe');
    assert.equal(f.actions.length, 0);
    assert.equal(f.panel.querySelectorAll('img').length, 0);
    f.click('Review in app'); await flush();
    assert.equal(f.actions[0].view, 'tasks');
    assert.equal(f.calls.some(body => /save|commit|send/.test(body.mode)), false);
  } finally { f.close(); }
});

test('stop cancels the server turn and ignores a response arriving after cancellation', async () => {
  let resolveTurn;
  const f = fixture(async body => body.mode === 'command' ? await new Promise(resolve => { resolveTurn = resolve; }) : {});
  try {
    const pending = f.ui.submit('How many roses?'); await flush();
    await f.ui.submit('stop');
    assert.equal(f.calls.at(-1).mode, 'cancel');
    resolveTurn({ reply: 'Stale answer', revision: 2 }); await pending;
    assert.doesNotMatch(f.panel.textContent, /Stale answer/);
    assert.equal(f.busy.at(-1), false);
  } finally { f.close(); }
});

test('a revoked identity cannot restore a late sensitive response', async () => {
  let resolveTurn;
  const f = fixture(async body => body.mode === 'command' ? await new Promise(resolve => { resolveTurn = resolve; }) : {});
  try {
    const pending = f.ui.submit('Read my latest messages'); await flush();
    f.revoke(); resolveTurn({ reply: 'Private message contents' }); await pending;
    assert.doesNotMatch(f.panel.textContent, /Private message contents/);
  } finally { f.close(); }
});

test('history retains six completed exchanges, truncates messages, and respects UTF-8 bytes', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index}` }));
  assert.deepEqual(boundedAuraChatHistory(messages), messages.slice(-12));
  const unicode = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: '🌳'.repeat(1500) }));
  const bounded = boundedAuraChatHistory(unicode);
  assert.ok(bounded.length > 0 && bounded.length % 2 === 0 && bounded.length <= 12);
  assert.ok(bounded.every(message => message.content.length <= 2000));
  assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).byteLength <= 8192);
});

test('restored conversations supply their latest completed exchanges and New chat clears memory', async () => {
  const f = fixture(async body => {
    if (body.mode === 'list') return { conversations: [{ id: 'saved', title: 'Saved plants' }] };
    if (body.mode === 'read') return { conversationId: 'saved', turns: [
      { text: 'Where is itemcode 000123?', response: { reply: 'Previous location A.01.' }, completed: true },
      { text: 'Cancelled question', response: { reply: 'Refresh this response' }, completed: false },
    ] };
    return { reply: 'Current verified facts.' };
  });
  try {
    f.click('Conversations'); await flush(); f.click('Saved plants'); await flush();
    await f.ui.submit('How many of those?');
    assert.deepEqual(f.calls.at(-1).history, [{ role: 'user', content: 'Where is itemcode 000123?' },
      { role: 'assistant', content: 'Previous location A.01.' }]);
    f.click('New chat'); await flush(); await f.ui.submit('A new question');
    assert.deepEqual(f.calls.at(-1).history, []);
  } finally { f.close(); }
});

test('failed and cancelled turns never enter subsequent model history', async () => {
  let fail = true;
  const f = fixture(async body => { if (body.mode === 'command' && fail) { fail = false; throw new Error('Unavailable'); } return { reply: 'Verified answer' }; });
  try {
    await f.ui.submit('Failed question'); await f.ui.submit('Fresh question');
    assert.deepEqual(f.calls.at(-1).history, []);
    await f.ui.submit('Follow-up');
    assert.deepEqual(f.calls.at(-1).history, [{ role: 'user', content: 'Fresh question' }, { role: 'assistant', content: 'Verified answer' }]);
  } finally { f.close(); }
});

test('a transport retry keeps the turn ID so the server can replay a committed answer', async () => {
  let failed = false;
  const f = fixture(async body => {
    if (body.mode === 'command' && !failed) { failed = true; throw new Error('Connection lost'); }
    return { reply: 'Verified result' };
  });
  try {
    await f.ui.submit('How many roses?');
    const original = f.calls.find(body => body.mode === 'command');
    f.click('Retry question'); await flush();
    assert.equal(f.calls.at(-1).turnId, original.turnId);
    assert.match(f.panel.textContent, /Verified result/);
  } finally { f.close(); }
});

test('open-stock questions fall back to bounded deterministic inventory and clear processing state', async () => {
  const context = vm.createContext({
    Intl, Date,
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? '',
  });
  vm.runInContext(`${extractRuntimeFunction('parseAuraDeterministicInventoryQuestion')}\n${extractRuntimeFunction('buildAuraDeterministicInventoryAnswer')}`, context);
  const query = context.parseAuraDeterministicInventoryQuestion('how many 3DP baby gem in open stock?');
  assert.deepEqual(JSON.parse(JSON.stringify(query.plantTerms)), ['baby', 'gem']);
  assert.equal(query.contSize, '3DP');
  assert.equal(query.metric, 'openStock');
  assert.equal(query.season, 'F1');
  assert.equal(query.salesYear, 27);
  const answer = context.buildAuraDeterministicInventoryAnswer(query, [
    { unique_id: 'one', commonname: 'Baby Gem Boxwood', itemcode: 'BG-3', contsize: '3DP', locationcode: 'A.01.001', lotcode: '27.F1', season: 'F1', saleyear: 27, s_lts: 12, ptravailable: 9, ptronhand: 11, ptrreviewed: 2 },
    { unique_id: 'two', commonname: 'Baby Gem Boxwood', itemcode: 'BG-3', contsize: '3DP', locationcode: 'A.01.002', lotcode: '26.F1', season: 'F1', saleyear: 26, s_lts: 12, ptravailable: 6, ptronhand: 8, ptrreviewed: 1 },
    { unique_id: 'wrong-season', commonname: 'Baby Gem Boxwood', itemcode: 'BG-3', contsize: '3DP', locationcode: 'A.03.001', lotcode: '27.S1', season: 'S1', saleyear: 27, s_lts: 90, ptravailable: 90, ptronhand: 90 },
    { unique_id: 'future-year', commonname: 'Baby Gem Boxwood', itemcode: 'BG-3', contsize: '3DP', locationcode: 'A.04.001', lotcode: '28.F1', season: 'F1', saleyear: 28, s_lts: 80, ptravailable: 80, ptronhand: 80 },
    { unique_id: 'unrelated-size', commonname: 'Gatsby Glow Ball Oakleaf Hydrangea', itemcode: 'GG-3', contsize: '3DP', locationcode: 'F.14.000', lotcode: '27.F1', season: 'F1', saleyear: 27, s_lts: 70, ptravailable: 70, ptronhand: 70 },
    { unique_id: 'wrong-size', commonname: 'Baby Gem Boxwood', itemcode: 'BG-7', contsize: '#7', locationcode: 'A.02.001', lotcode: '27.F1', season: 'F1', saleyear: 27, s_lts: 99, ptravailable: 99, ptronhand: 99 },
  ], { source: 'masterInventory' });
  assert.match(answer.reply, /12 Open Stock for Season F1 \(Sales Year <= 27\), 15 Available, 19 On Hand, and 3 Review/);
  assert.doesNotMatch(answer.reply, /I found possible matches|Gatsby Glow Ball/);
  assert.equal(answer.actions[0].rows.length, 2);
  assert.ok(answer.actions[0].rows.every(row => row.commonname === 'Baby Gem Boxwood' && row.contsize === '3DP' && row.season === 'F1' && row.salesYear <= 27));

  let resolveRequest;
  const panel = fixture(async body => body.mode === 'command' ? await new Promise(resolve => { resolveRequest = resolve; }) : {});
  try {
    panel.input.value = 'how many 3DP baby gem in open stock?';
    const pending = panel.ui.submit(panel.input.value);
    await flush();
    assert.equal(panel.input.value, '', 'submission clears the input before the request finishes');
    resolveRequest(answer);
    await pending;
    assert.equal(panel.busy.at(-1), false, 'finally resets the AURA Processing state');
    assert.equal(panel.states.at(-1), 'idle', 'rendered replies reset the AURA subtitle to Ready when you are.');
    assert.match(panel.panel.textContent, /12 Open Stock/);
    assert.doesNotMatch(panel.panel.textContent, /I found possible matches|Gatsby Glow Ball/);
  } finally { panel.close(); }

  const appApi = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../supabase/functions/_shared/aura-voice-handler.ts', import.meta.url), 'utf8');
  const widget = readFileSync(new URL('../components/common/auraVoiceWidget.js', import.meta.url), 'utf8');
  assert.match(appApi, /operation === "resolve_query"[^]*resolveAuraDeterministicInventoryQuery/);
  assert.match(appApi, /commonName\.includes\(normalized\(term\)\)[^]*rowSeason !== parsed\.season[^]*rowSalesYear > parsed\.salesYear/);
  assert.match(router, /scopeAuraOpenStock[^]*season = String\(filters\.season \|\| "F1"\)[^]*filters\.salesYear = Number\.isInteger\(filters\.salesYear\) \? filters\.salesYear : 27/);
  assert.match(router, /strictInventoryIdentityMatch[^]*commonName\.includes\(token\)[^]*distinctInventoryIdentities/);
  assert.match(widget, /function finishSignal\([^]*busy = false;[^]*setRecognitionBusy\(false\);[^]*renderStatus\(\);/);
});

test('a conversation whose sources are revoked can still be explicitly deleted', async () => {
  const f = fixture(async body => {
    if (body.mode === 'list') return { conversations: [{ id: 'revoked', title: 'Saved work' }] };
    if (body.mode === 'read') throw new Error('Access no longer available');
    return {};
  });
  try {
    f.click('Conversations'); await flush(); f.click('Saved work'); await flush();
    assert.match(f.panel.textContent, /Access no longer available/);
    f.click('Delete chat'); await flush(); f.click('Delete permanently'); await flush();
    assert.equal(f.calls.at(-1).mode, 'delete'); assert.equal(f.calls.at(-1).conversationId, 'revoked');
  } finally { f.close(); }
});
