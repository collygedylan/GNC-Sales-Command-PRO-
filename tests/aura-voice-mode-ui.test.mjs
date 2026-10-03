import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountAuraWidget } from "../components/common/auraVoiceWidget.js";

function browserEnvironment({ available = "available", includeRecognition = true } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://field.example.test/",
  });
  Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value: "visible" });
  const previous = new Map();
  for (const name of ["window", "document", "navigator"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  const engines = [];
  class FakeRecognition {
    static async available() { return available; }
    constructor() {
      this.processLocally = false;
      this.aborted = false;
      engines.push(this);
    }
    start() { this.started = true; this.onstart?.(); }
    abort() { this.aborted = true; }
    stop() { this.stopped = true; }
  }
  if (includeRecognition) {
    Object.defineProperty(dom.window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
  }
  Object.defineProperty(dom.window, "speechSynthesis", { configurable: true, value: null });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { permissions: { query: async () => ({ state: "granted" }) } },
  });
  return {
    dom,
    engines,
    async restore() {
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

async function useStandardLookup() {
  const fallback = [...document.querySelectorAll(".aura-retry")].find(button => button.textContent === "Use standard lookup");
  assert.ok(fallback, "router failures offer an explicit standard-lookup fallback");
  fallback.click();
  await flush();
}

function mount(options = {}) {
  return mountAuraWidget({ isAuthorized: () => true, ...options });
}

function openPanel() {
  document.querySelector(".aura-fab").click();
  return document.querySelector(".aura-panel");
}

function result(transcript, isFinal = true) {
  const alternative = { transcript, confidence: 0.99 };
  const item = [alternative];
  item.isFinal = isFinal;
  return { results: [item], resultIndex: 0 };
}

test("recognition mode badge persists through transcript and error status updates", async () => {
  const env = browserEnvironment({ available: "available" });
  const widget = mount();
  try {
    const panel = openPanel();
    const badge = panel.querySelector(".aura-mode");
    const mic = panel.querySelector(".aura-mic");
    assert.equal(badge.textContent, "Voice input mode not selected");
    assert.equal(mic.getAttribute("aria-label"), "Start voice input");

    mic.click();
    await flush();
    const engine = env.engines[0];
    assert.ok(engine);
    assert.equal(engine.processLocally, true);
    assert.equal(badge.textContent, "On-device speech");
    assert.equal(mic.getAttribute("aria-label"), "Pause voice input");

    engine.onerror({ error: "audio-capture" });
    assert.equal(badge.textContent, "On-device speech");
    assert.match(panel.querySelector(".aura-status").textContent, /microphone|type a command/i);
    assert.equal(mic.getAttribute("aria-label"), "Start voice input");
    mic.click();
    await flush();
    const activeEngine = env.engines.at(-1);
    activeEngine.onresult(result("Hey Aura, florp"));
    await flush();
    assert.equal(badge.textContent, "On-device speech");
    assert.match(panel.querySelector(".aura-status").textContent, /Listening on this device/i);
    assert.match(panel.querySelector(".aura-message").textContent, /not configured/i);
    assert.ok([...panel.querySelectorAll(".aura-retry")].some(button => button.textContent === "Retry AURA"));

  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("browser recognition is clearly disclosed and status never claims on-device processing", async () => {
  const env = browserEnvironment({ available: "unavailable" });
  const widget = mount();
  try {
    const panel = openPanel();
    const badge = panel.querySelector(".aura-mode");
    const mic = panel.querySelector(".aura-mic");
    mic.click();
    await flush();

    assert.equal(env.engines.length, 1);
    assert.equal(env.engines[0].processLocally, false);
    assert.equal(badge.textContent, "Browser speech — tap per command · may use network");
    assert.match(panel.querySelector(".aura-status").textContent, /browser/i);
    assert.doesNotMatch(panel.querySelector(".aura-status").textContent, /on-device|locally/i);
    assert.equal(mic.getAttribute("aria-label"), "Pause voice input");

    env.engines[0].onresult(result("Hey Aura, cloud locally remote", false));
    await flush();
    assert.equal(badge.textContent, "Browser speech — tap per command · may use network");
    assert.match(panel.querySelector(".aura-status").textContent, /cloud locally remote/i);
    assert.doesNotMatch(panel.querySelector(".aura-status").textContent, /in the browser network/i);
    env.engines[0].onerror({ error: "audio-capture" });
    assert.equal(badge.textContent, "Browser speech — tap per command · may use network");
    assert.doesNotMatch(panel.querySelector(".aura-status").textContent, /on-device|locally/i);
    assert.equal(mic.getAttribute("aria-label"), "Start voice input");
  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("browser push-to-talk accepts no-wake commands, deduplicates results, and keeps draft across taps", async () => {
  const env = browserEnvironment({ available: "unavailable" });
  const catalogCalls = [];
  const lotCalls = [];
  const resolvedCustomers = [];
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async customerName => {
      resolvedCustomers.push(customerName);
      return { items: [{ key: "party-1", customerName, label: customerName }], hasMore: false };
    },
    requestV2: async body => {
      if (body.operation === "match") {
        catalogCalls.push(body);
        return { complete: true, exactMatch: true, additionalMatches: false, rows: [{ matchKind: "exact", itemcode: "SKU1", commonname: "Limelight", contsize: "3DP" }] };
      }
      if (body.operation === "lots") {
        lotCalls.push(body);
        return { complete: true, hasMore: false, rows: [{ unique_id: "lot-1", itemcode: "SKU1", commonname: "Limelight", contsize: "3DP", ptravailable: 200 }] };
      }
      throw new Error(`Unexpected operation ${body.operation}`);
    },
  });
  try {
    const panel = openPanel();
    const mic = panel.querySelector(".aura-mic");
    mic.click();
    await flush();
    assert.equal(panel.querySelector(".aura-mode").textContent, "Browser speech — tap per command · may use network");

    const first = env.engines[0];
    const duplicate = first.onresult;
    const startEvent = result("Start a request for Megan");
    duplicate(startEvent);
    duplicate(startEvent);
    first.onend();
    await flush();
    assert.deepEqual(resolvedCustomers, ["Megan"]);
    assert.match(panel.querySelector(".aura-message").textContent, /Request started for Megan/i);
    assert.equal(panel.querySelector(".aura-status").textContent, "Tap the microphone for your next command. Your current draft is still here.");
    assert.equal(mic.getAttribute("aria-label"), "Start voice input");

    mic.click();
    await flush();
    assert.equal(env.engines.length, 2, "the next utterance requires a fresh mic tap");
    env.engines[1].onresult(result("50 three deep pee Limelight"));
    env.engines[1].onend();
    await flush();
    await useStandardLookup();
    assert.deepEqual(lotCalls.map(call => call.quantity), [50]);
    assert.match(panel.querySelector(".aura-message").textContent, /Added 50 3DP Limelight/i);
    assert.equal(panel.querySelector(".aura-status").textContent, "Tap the microphone for your next command. Your current draft is still here.");
    assert.equal(mic.getAttribute("aria-label"), "Start voice input");

    mic.click();
    await flush();
    assert.equal(env.engines.length, 3, "each additional item requires another mic tap");
    env.engines[2].onresult(result("25 three deep pee Limelight"));
    env.engines[2].onend();
    await flush();
    await useStandardLookup();
    assert.deepEqual(lotCalls.map(call => call.quantity), [50, 75]);
    assert.match(panel.querySelector(".aura-message").textContent, /Updated the request to 75 3DP Limelight/i);
    assert.equal(catalogCalls.length, 1, "the verified catalog is reused across the short draft session");
    assert.match(panel.querySelector(".aura-mode").textContent, /tap per command/);
  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("resuming a browser-mode request draft does not start the microphone", async () => {
  const env = browserEnvironment({ available: "unavailable" });
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async customerName => ({ items: [{ key: "party-1", customerName }], hasMore: false }),
  });
  try {
    const panel = openPanel();
    const mic = panel.querySelector(".aura-mic");
    mic.click();
    await flush();
    env.engines[0].onresult(result("Start a request for Megan"));
    env.engines[0].onend();
    await flush();

    // Simulate the app hiding and returning: the request remains paused, and
    // resuming its draft must not silently open browser speech input.
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    await flush();
    [...panel.querySelectorAll(".aura-cart-controls .aura-action")]
      .find(button => button.textContent === "Resume request")?.click();
    await flush();
    assert.equal(env.engines.length, 1);
    assert.equal(panel.querySelector(".aura-mode").textContent, "Browser speech — tap per command · may use network");
    assert.match(panel.querySelector(".aura-message").textContent, /request resumed/i);
  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("browser busy state reports a closed mic and completion does not hide active speech", async () => {
  const env = browserEnvironment({ available: "unavailable" });
  const utterances = [];
  class FakeUtterance { constructor(text) { this.text = text; } }
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => [{ name: "Local English", lang: "en-US", localService: true }],
      cancel() {},
      speak(utterance) { utterances.push(utterance); },
    },
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
  let resolveSend;
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    sendMessage: () => new Promise(resolve => { resolveSend = resolve; }),
  });
  try {
    const panel = openPanel();
    const mic = panel.querySelector(".aura-mic");
    mic.click();
    await flush();
    env.engines[0].onresult(result("send a message to Megan saying The bay is ready"));
    env.engines[0].onend();
    await flush();

    assert.equal(mic.getAttribute("aria-pressed"), "false", "a query may be processing, but browser capture is closed");
    assert.equal(panel.querySelector(".aura-status").textContent, "AURA is checking that request…");
    resolveSend({ ok: true, recipientName: "Megan" });
    await flush();

    assert.equal(utterances.length, 1);
    assert.equal(panel.querySelector(".aura-status").textContent, "AURA is responding…");
    assert.equal(mic.getAttribute("aria-pressed"), "false");

    utterances[0].onend();
    assert.equal(panel.querySelector(".aura-status").textContent, "Tap the microphone for your next command.");
  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("selected local mode survives AURA speech and recognizer restart", async () => {
  const env = browserEnvironment({ available: "available" });
  const utterances = [];
  class FakeUtterance { constructor(text) { this.text = text; } }
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => [{ name: "Local English", lang: "en-US", localService: true }],
      cancel() {},
      speak(utterance) { utterances.push(utterance); },
    },
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
  const widget = mount({ requestV2: async () => ({ complete: true, winner: { commonname: "Limelight", contsize: "3DP", total: 12 }, tieCount: 1 }) });
  try {
    const panel = openPanel();
    panel.querySelector(".aura-mic").click();
    await flush();
    assert.equal(panel.querySelector(".aura-mode").textContent, "On-device speech");

    const input = panel.querySelector("input");
    input.value = "What item has largest U1 value?";
    panel.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    assert.equal(panel.querySelector(".aura-status").textContent, "AURA is responding…");
    assert.equal(panel.querySelector(".aura-mode").textContent, "On-device speech");
    assert.equal(utterances.length, 1);

    utterances[0].onend();
    await flush();
    assert.equal(env.engines.length, 2);
    assert.equal(env.engines[1].processLocally, true);
    assert.equal(panel.querySelector(".aura-mode").textContent, "On-device speech");
  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("typed chat remains available when voice recognition is unsupported", async () => {
  const env = browserEnvironment({ includeRecognition: false });
  const sent = [];
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    sendMessage: async intent => {
      sent.push(intent);
      return { ok: true, recipientName: intent.recipientName };
    },
  });
  try {
    const panel = openPanel();
    panel.querySelector(".aura-mic").click();
    await flush();
    assert.match(panel.querySelector(".aura-mode").textContent, /not selected/i);
    assert.match(panel.querySelector(".aura-status").textContent, /unavailable|type a command/i);

    const input = panel.querySelector("input[aria-label='Type a command for AURA']");
    input.value = "send a message to Megan saying The bay is ready";
    panel.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipientName, "Megan");
    assert.equal(panel.querySelector(".aura-message").textContent, "Message sent to Megan.");
  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("voice controls retain neutral accessible labels and 44px minimum targets", () => {
  const env = browserEnvironment();
  const widget = mount();
  try {
    const panel = openPanel();
    const mic = panel.querySelector(".aura-mic");
    assert.equal(mic.getAttribute("aria-label"), "Start voice input");
    assert.match(mic.getAttribute("aria-label"), /^(Start|Pause|Resume) voice input$/);
    const style = document.getElementById("aura-voice-widget-styles").textContent;
    assert.match(style, /\.aura-mic\{[^}]*width:48px;height:48px/s);
    assert.match(style, /\.aura-action\{[^}]*min-height:44px/s);
    assert.match(style, /\.aura-head>div:nth-child\(2\)\{[^}]*min-width:0/s);
    assert.match(style, /\.aura-mode\{[^}]*max-width:100%[^}]*overflow-wrap:anywhere/s);
    assert.equal(panel.querySelector(".aura-mode").getAttribute("aria-live"), "polite");
  } finally {
    widget.destroy();
    void env.restore();
  }
});

function enter(command) {
  document.querySelector('.aura-inputbar input').value = command;
  document.querySelector('.aura-inputbar').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
const babyGem = { itemcode: 'BG', commonname: 'Baby Gem® Boxwood', contsize: '3DP', matchKind: 'exact' };
const exactBabyGem = { complete: true, exactMatch: true, additionalMatches: false, rows: [babyGem] };

test('browser previews every correction, then submits interim-only text once on normal end', async () => {
  const env = browserEnvironment({ available: 'unavailable' });
  const sent = [];
  const widget = mountAuraWidget({ isAuthorized: () => true, sendMessage: async intent => { sent.push(intent); return { ok: true, recipientName: 'Megan' }; } });
  try {
    const panel = openPanel(); panel.querySelector('.aura-mic').click(); await flush();
    const engine = env.engines[0];
    engine.onresult(result('send a message to Megan saying Bay one', false));
    assert.equal(panel.querySelector('input').value, 'send a message to Megan saying Bay one');
    engine.onresult(result('send a message to Megan saying Bay two', false));
    assert.equal(panel.querySelector('input').value, 'send a message to Megan saying Bay two');
    assert.equal(sent.length, 0);
    engine.onspeechend(); assert.equal(engine.stopped, true);
    const end = engine.onend; end(); end(); await flush();
    assert.equal(sent.length, 1); assert.equal(sent[0].message, 'Bay two');
    assert.equal(env.engines.length, 1);
  } finally { widget.destroy(); await env.restore(); }
});

test('bounded matching uses one lookup, authoritative count, and scoped 30-second metadata cache', async () => {
  const env = browserEnvironment(); const calls = [];
  const widget = mountAuraWidget({ isAuthorized: () => true, requestV2: async body => {
    calls.push(body); return body.operation === 'match' ? exactBabyGem : { complete: true, total: 450, season: 'U2', rows: [] };
  } });
  try {
    openPanel(); enter('How many 3DP baby gem boxwood are in open stock'); await flush(); await useStandardLookup();
    assert.deepEqual(calls.map(x => x.operation), ['match', 'count']);
    assert.equal(calls[0].commonName, 'baby gem boxwood'); assert.equal(calls[0].contSize, '3DP'); assert.equal(calls[0].openStockOnly, true);
    assert.match(document.querySelector('.aura-message').textContent, /450/);
    enter('How many 3DP baby gem boxwood are in open stock'); await flush(); await useStandardLookup();
    assert.deepEqual(calls.map(x => x.operation), ['match', 'count', 'count']);
    enter('How many 3DP baby gem boxwood in U1'); await flush(); await useStandardLookup();
    assert.equal(calls.filter(x => x.operation === 'match').length, 2);
  } finally { widget.destroy(); await env.restore(); }
});

test('fuzzy matches require selection and wrong sizes or incomplete matches never assert quantities', async () => {
  for (const data of [
    { ...exactBabyGem, exactMatch: false, rows: [{ ...babyGem, matchKind: 'fuzzy' }] },
    { ...exactBabyGem, rows: [{ ...babyGem, contsize: '#3' }] },
    { ...exactBabyGem, complete: false },
    { ...exactBabyGem, rows: [] },
  ]) {
    const env = browserEnvironment(); const calls = [];
    const widget = mountAuraWidget({ isAuthorized: () => true, requestV2: async body => { calls.push(body); return data; } });
    try {
      openPanel(); enter('How many 3DP baby gem boxwood are in open stock'); await flush(); await useStandardLookup();
      assert.deepEqual(calls.map(x => x.operation), ['match']);
      if (data.rows[0]?.matchKind === 'fuzzy') assert.equal(document.querySelectorAll('.aura-choice').length, 1);
      else assert.ok(document.querySelector('.aura-retry'));
    } finally { widget.destroy(); await env.restore(); }
  }
});

test('five-second command budget spans matching and quantity, rejects late results, and offers Retry', async t => {
  const env = browserEnvironment();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = []; let resolveMatch, resolveCount;
  const widget = mountAuraWidget({ isAuthorized: () => true, requestV2: (body, options) => {
    calls.push({ body, options });
    if (calls.length > 2) return Promise.resolve(body.operation === 'match' ? exactBabyGem : { complete: true, total: 450, rows: [] });
    return new Promise(resolve => { if (body.operation === 'match') resolveMatch = resolve; else resolveCount = resolve; });
  } });
  try {
    openPanel(); enter('How many 3DP baby gem boxwood are in open stock'); await flush(); await useStandardLookup();
    t.mock.timers.tick(3000); resolveMatch(exactBabyGem); await flush();
    assert.equal(calls.length, 2); assert.equal(calls[0].options.deadlineAt, calls[1].options.deadlineAt);
    t.mock.timers.tick(2000); await flush();
    assert.equal(calls[1].options.signal.aborted, true);
    assert.match(document.querySelector('.aura-message').textContent, /five seconds/);
    assert.equal(document.querySelector('input').value, 'How many 3DP baby gem boxwood are in open stock');
    resolveCount({ complete: true, total: 999, rows: [] }); await flush();
    assert.doesNotMatch(document.querySelector('.aura-message').textContent, /999/);
    document.querySelector('.aura-retry').click(); await flush();
    assert.equal(calls[2].options.explicitRetry, true);
    assert.match(document.querySelector('.aura-message').textContent, /450/);
  } finally { widget.destroy(); t.mock.timers.reset(); await env.restore(); }
});

test('hide and sign-out cancel stalled matching without Retry or late UI mutation', async () => {
  for (const reason of ['hide', 'signout']) {
    const env = browserEnvironment(); let authorized = true, resolveRead; let signal;
    const widget = mountAuraWidget({ isAuthorized: () => authorized, requestV2: (_, options) => {
      signal = options.signal; return new Promise(resolve => { resolveRead = resolve; });
    } });
    try {
      openPanel(); enter('How many 3DP baby gem boxwood'); await flush(); await useStandardLookup();
      if (reason === 'hide') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new window.Event('visibilitychange'));
      } else { authorized = false; widget.destroy(); }
      await flush(); assert.equal(signal.aborted, true);
      resolveRead(exactBabyGem); await flush();
      assert.equal(document.querySelectorAll('.aura-retry').length, 0);
    } finally { widget.destroy(); await env.restore(); }
  }
});
