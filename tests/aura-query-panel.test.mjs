import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountAuraQueryPanel } from '../components/common/auraQueryPanel.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(handler = async () => ({})) {
  const dom = new JSDOM('<section><div></div><input></section>');
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  const panel = document.querySelector('section'), content = panel.querySelector('div'), input = panel.querySelector('input');
  const calls = [], actions = [], busy = [];
  let authorized = true;
  const ui = mountAuraQueryPanel({ panel, content, input, isAuthorized: () => authorized,
    request: async (body, options) => { calls.push(body); return { ok: true, conversationId: 'chat-1', revision: 1, ...await handler(body, options) }; },
    speak() {}, setBusy: value => busy.push(value), openAction: async action => actions.push(action),
  });
  const click = text => { const button = [...panel.querySelectorAll('button')].find(node => node.textContent === text && !node.disabled); assert.ok(button, text); button.click(); };
  return { ui, calls, actions, busy, panel, content, input, click, revoke() { authorized = false; },
    close() { ui.destroy(); if (prior) Object.defineProperty(globalThis, 'document', prior); else delete globalThis.document; dom.window.close(); } };
}

test('internal commands create private history and carry only the conversation reference on follow-up', async () => {
  const f = fixture(async body => body.mode === 'command' ? { reply: 'Verified 12 available.', revision: body.expectedRevision + 1, actions: [] } : {});
  try {
    await f.ui.submit('How many roses in C.06?');
    await f.ui.submit('only Zoe’s');
    assert.deepEqual(f.calls.map(value => value.mode), ['create', 'command', 'command']);
    assert.equal(f.calls[2].conversationId, 'chat-1');
    assert.equal(f.calls[2].expectedRevision, 2);
    assert.deepEqual(f.calls[2].context, {});
    assert.equal(f.calls[2].text, 'only Zoe’s');
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
