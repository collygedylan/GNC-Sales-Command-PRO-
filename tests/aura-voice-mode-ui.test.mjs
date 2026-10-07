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
    assert.equal(engine.continuous, false, "the mic button uses a single local utterance");
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
    assert.doesNotMatch(panel.querySelector(".aura-status").textContent, /hands-free listening/i);
    assert.match(panel.querySelector(".aura-message").textContent, /not configured/i);
    assert.ok([...panel.querySelectorAll(".aura-retry")].some(button => button.textContent === "Retry AURA"));

  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("browser recognition uses compact status without a verbose disclosure card", async () => {
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
    assert.equal(badge.style.display, "");
    assert.match(document.getElementById("aura-voice-widget-styles").textContent, /\.aura-mode\{display:none\}/);
    assert.match(panel.querySelector(".aura-status").textContent, /listening|starting/i);
    assert.equal(mic.getAttribute("aria-label"), "Pause voice input");

    env.engines[0].onresult(result("Hey Aura, cloud locally remote", false));
    await flush();
    assert.equal(badge.textContent, "Browser speech — tap per command · may use network");
    assert.equal(panel.querySelector(".aura-status").textContent, "Checking request…");
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

test("mic button captures one local command and requires another tap for the next turn", async () => {
  const env = browserEnvironment({ available: "available" });
  let resolveCommand;
  const widget = mount({ requestAssistant: body => body.mode === "command"
    ? new Promise(resolve => { resolveCommand = resolve; })
    : Promise.resolve({ ok: true, conversationId: "tap-thread", revision: 0 }) });
  try {
    const panel = openPanel();
    await flush();
    const mic = panel.querySelector(".aura-mic");
    mic.click(); await flush();
    assert.equal(env.engines[0].continuous, false);
    env.engines[0].onresult(result("How many roses?", true));
    for (let attempt = 0; attempt < 10 && !resolveCommand; attempt += 1) await flush();
    assert.ok(resolveCommand, "the spoken command should be sent after one-shot recognition");
    resolveCommand({ ok: true, conversationId: "tap-thread", revision: 1, reply: "Checked." });
    await flush(); await flush();
    assert.equal(env.engines.length, 1, "processing the command must not reopen the tap-to-talk mic");
    assert.match(panel.querySelector(".aura-status").textContent, /tap the microphone to speak again/i);
    mic.click(); await flush();
    assert.equal(env.engines.length, 2, "the next one-shot starts only after another mic tap");
    assert.equal(env.engines[1].continuous, false);
  } finally { widget.destroy(); await env.restore(); }
});

test("clicking a voice-produced party choice does not speak a follow-up response", async () => {
  const env = browserEnvironment({ available: "available" });
  const utterances = [];
  class FakeUtterance { constructor(text) { this.text = text; } }
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    getVoices: () => [{ name: "Local English", lang: "en-US", localService: true }], cancel() {}, speak: item => utterances.push(item),
  } });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
  const widget = mount({ resolveOrderParty: async () => ({ items: [
    { key: "north", customerName: "Acme", label: "Acme North" },
    { key: "south", customerName: "Acme", label: "Acme South" },
  ], hasMore: false }) });
  try {
    const panel = openPanel();
    await flush();
    panel.querySelector(".aura-mic").click(); await flush();
    env.engines[0].onresult(result("Start a request for Acme", true));
    await flush();
    assert.equal(panel.querySelectorAll(".aura-choice").length, 2, "voice turn should present exact party choices");
    panel.querySelector(".aura-choice").click();
    assert.equal(utterances.length, 0, "a click choice must remain silent after an earlier voice turn");
  } finally { widget.destroy(); await env.restore(); }
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
    assert.equal(panel.querySelector(".aura-status").textContent, "Tap mic to speak");
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
    assert.equal(panel.querySelector(".aura-status").textContent, "Tap mic to speak");
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
    assert.equal(panel.querySelector(".aura-status").textContent, "Checking request…");
    resolveSend({ ok: true, recipientName: "Megan" });
    await flush();

    assert.equal(utterances.length, 1);
    assert.equal(panel.querySelector(".aura-status").textContent, "Aura responding…");
    assert.equal(mic.getAttribute("aria-pressed"), "false");

    utterances[0].onend();
    assert.equal(panel.querySelector(".aura-status").textContent, "Tap mic to speak");
  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("typed responses stay silent while explicit hands-free local recognition resumes", async () => {
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
    await flush(); // Let the widget's background local-capability probe finish before the trusted start.
    widget.startHandsFreeFromGesture();
    await flush();
    assert.equal(env.engines[0].continuous, true, "hands-free remains continuous while tap-to-talk is one-shot");
    assert.equal(panel.querySelector(".aura-mode").textContent, "On-device speech");

    const input = panel.querySelector("input");
    input.value = "What item has largest U1 value?";
    panel.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    assert.match(panel.querySelector(".aura-status").textContent, /hands-free listening/i);
    assert.equal(panel.querySelector(".aura-mode").textContent, "On-device speech");
    assert.equal(utterances.length, 0, "typed questions do not trigger speech synthesis");

    await flush();
    assert.equal(env.engines.length, 2, "the hands-free local recognizer resumes after typed work completes");
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
    assert.match(style, /\.aura-mode\{display:none\}/);
  } finally {
    widget.destroy();
    void env.restore();
  }
});

test("hands-free recognizes both wake phrases, waits for finalized speech, and arbitrates external audio", async () => {
  const env = browserEnvironment({ available: "unavailable" });
  const sent = [];
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    userId: "auth-user-7",
    sendMessage: async intent => { sent.push(intent); return { ok: true, recipientName: intent.recipientName }; },
  });
  try {
    assert.equal(widget.getHandsFreeAutoStart(), false);
    widget.setHandsFreeAutoStart(true);
    await flush();
    assert.equal(window.localStorage.getItem("aura.handsFree.autostart:auth-user-7"), "true");
    assert.equal(env.engines.length, 1);
    assert.equal(env.engines[0].continuous, true);
    assert.equal(env.engines[0].processLocally, false);
    assert.equal(document.querySelector(".aura-fab").dataset.handsFreeListening, "true");

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(env.engines[0].aborted, true, "backgrounding pauses continuous recognition");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    await flush();
    assert.equal(env.engines.length, 2, "returning to foreground resumes hands-free listening");

    const engine = env.engines.at(-1);
    engine.onresult(result("Okay Aura, send a message to Megan saying The bay is ready", false));
    await new Promise(resolve => setTimeout(resolve, 850));
    assert.equal(sent.length, 0, "interim speech must never be submitted");
    engine.onresult(result("Okay Aura, send a message to Megan saying The bay is ready", true));
    await new Promise(resolve => setTimeout(resolve, 850));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipientName, "Megan");

    const secondEngine = env.engines.at(-1);
    secondEngine.onresult(result("Hey Aura, send a message to Zoe saying North gate", true));
    await new Promise(resolve => setTimeout(resolve, 850));
    assert.equal(sent.length, 2, "the alternate wake phrase is accepted");
    assert.equal(sent[1].recipientName, "Zoe");

    const thirdEngine = env.engines.at(-1);
    const sr = (transcript, isFinal) => Object.assign([{ transcript, confidence: 0.99 }], { isFinal });
    const finalizedBase = "Hey Aura, send a message to Ava saying The north gate";
    thirdEngine.onresult({ results: [sr(finalizedBase, true)], resultIndex: 0 });
    await new Promise(resolve => setTimeout(resolve, 450));
    thirdEngine.onresult({ results: [sr(finalizedBase, true), sr("Wait, I meant dock three", false)], resultIndex: 1 });
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(sent.length, 2, "a new interim result cancels the pending final-settle timer");
    thirdEngine.onresult({ results: [sr(finalizedBase, true), sr("Wait, I meant dock three", true)], resultIndex: 1 });
    await new Promise(resolve => setTimeout(resolve, 850));
    assert.equal(sent.length, 3);
    assert.match(sent[2].message, /dock three/i);

    const countBeforeClaim = env.engines.length;
    const release = window.GncAuraAudio.claim("leaf");
    const duplicateRelease = window.GncAuraAudio.claim("leaf");
    assert.equal(env.engines.at(-1).aborted, true);
    assert.equal(document.querySelector(".aura-fab").dataset.handsFreeListening, "false");
    release();
    await flush();
    assert.equal(env.engines.length, countBeforeClaim + 1, "releasing another audio owner resumes manual hands-free mode");
    assert.equal(env.engines.at(-1).continuous, true);
    duplicateRelease();
    await flush();
    assert.equal(env.engines.length, countBeforeClaim + 1, "duplicate owner release is idempotent");
    widget.setHandsFreeAutoStart(false);
    assert.equal(window.localStorage.getItem("aura.handsFree.autostart:auth-user-7"), "false");
  } finally {
    widget.destroy();
    await env.restore();
  }
});

test("typed Aura answers stay silent and voice answers use the complete chunked speech", async () => {
  const env = browserEnvironment({ available: "unavailable" });
  const utterances = [];
  class FakeUtterance { constructor(text) { this.text = text; } }
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    getVoices: () => [{ name: "Local English", lang: "en-US", localService: true }], cancel() {}, speak: item => utterances.push(item),
  } });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
  const longSpeech = `${"A complete spoken inventory answer contains several useful details. ".repeat(90)}END OF FULL ANSWER`;
  const widget = mountAuraWidget({ isAuthorized: () => true, userId: "speech-user", requestAssistant: async body => ({
    ok: true, conversationId: "speech-thread", revision: body.mode === "command" ? 1 : 0,
    reply: "Aura checked the current data.", speech: longSpeech,
  }) });
  try {
    const panel = openPanel();
    const input = panel.querySelector("input");
    input.value = "Give me the long answer";
    panel.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    assert.equal(utterances.length, 0, "typed questions never speak their full answer");

    widget.setHandsFreeAutoStart(true);
    await flush();
    env.engines[0].onresult(result("Hey Aura, give me the long answer", true));
    await new Promise(resolve => setTimeout(resolve, 850));
    assert.equal(utterances.length, 1);
    let full = "", guard = 0;
    while (utterances.at(-1)?.onend && guard++ < 40) {
      const item = utterances.at(-1); full += item.text;
      assert.ok(item.text.length <= 220, "native utterances stay short enough for browser support");
      item.onend();
    }
    assert.ok(utterances.length > 1, "long speech is queued sequentially");
    assert.match(full, /END OF FULL ANSWER$/, "the complete answer is spoken, not clipped to a preview");
  } finally { widget.destroy(); await env.restore(); }
});

function enter(command) {
  document.querySelector('.aura-inputbar input').value = command;
  document.querySelector('.aura-inputbar').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

test('runtime hands-free toggle is independent of Auto-Start and global mic reflects actual processing', async t => {
  const env = browserEnvironment({ available: 'unavailable' });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  let resolveCommand;
  const widget = mount({ userId: 'runtime-user', requestAssistant: async body => body.mode === 'command'
    ? await new Promise(resolve => { resolveCommand = resolve; }) : { ok: true, conversationId: 'voice-thread', revision: 0 } });
  try {
    const panel = openPanel();
    const toggle = [...panel.querySelectorAll('button')].find(button => button.textContent === 'Hands-Free Mode: Off');
    assert.ok(toggle); toggle.click(); await flush();
    assert.equal(widget.getHandsFreeAutoStart(), false);
    assert.equal(window.localStorage.getItem('aura.handsFree.autostart:runtime-user'), null);
    const fab = document.querySelector('.aura-fab');
    assert.equal(fab.dataset.handsFreeListening, 'true');
    panel.querySelector('.aura-close').click();
    assert.equal(fab.dataset.handsFreeListening, 'true', 'panel closure keeps the global listener');
    env.engines[0].onresult(result('Hey Aura how many roses', true));
    t.mock.timers.tick(800); await flush();
    assert.equal(fab.dataset.handsFreeListening, 'false', 'processing pauses actual capture');
    resolveCommand({ ok: true, reply: 'Twelve roses.', revision: 1 }); await flush();
    assert.equal(fab.dataset.handsFreeListening, 'true');
    toggle.click();
    assert.equal(fab.dataset.handsFreeListening, 'false');
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  } finally { widget.destroy(); t.mock.timers.reset(); await env.restore(); }
});

test('split wake phrases, quiet deadline, wake expiry and capture cap fence stale commands', async t => {
  const env = browserEnvironment({ available: 'unavailable' });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const sent = [];
  const widget = mount({ userId: 'wake-user', requestAssistant: async body => {
    if (body.mode === 'command') sent.push(body.text);
    return { ok: true, conversationId: 'voice-thread', revision: 1, reply: 'Checked.' };
  } });
  const emit = (engine, segments) => engine.onresult({ resultIndex: segments.length - 1,
    results: segments.map(([text, isFinal]) => Object.assign([{ transcript: text, confidence: .99 }], { isFinal })) });
  try {
    widget.startHandsFreeFromGesture(); await flush();
    let engine = env.engines.at(-1);
    emit(engine, [['Ambient words', true], ['Hey', true]]);
    assert.equal(document.querySelector('.aura-inputbar input').value, '', 'ambient words are not placed in the command field');
    emit(engine, [['Ambient words', true], ['Hey', true], ['Aura how many roses', true]]);
    t.mock.timers.tick(799); await flush(); assert.equal(sent.length, 0);
    t.mock.timers.tick(1); await flush(); assert.deepEqual(sent, ['how many roses']);
    engine = env.engines.at(-1);
    emit(engine, [['Hey Aura', true]]);
    t.mock.timers.tick(8000);
    emit(engine, [['Hey Aura', true], ['how many lilies', true]]);
    t.mock.timers.tick(800); await flush(); assert.equal(sent.length, 1, 'expired wake cannot capture a later ambient command');
    emit(engine, [['Hey Aura', true], ['how many lilies', true], ['Okay Aura how many roses', false]]);
    for (let i = 0; i < 5; i++) { t.mock.timers.tick(5000); emit(engine, [['Hey Aura', true], ['how many lilies', true], ['Okay Aura how many roses ' + i, false]]); }
    t.mock.timers.tick(4999);
    emit(engine, [['Hey Aura', true], ['how many lilies', true], ['Okay Aura how many roses finally', true]]);
    t.mock.timers.tick(801); await flush(); assert.equal(sent.length, 1, '30-second cap cancels a pending finalized command');
  } finally { widget.destroy(); t.mock.timers.reset(); await env.restore(); }
});
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
