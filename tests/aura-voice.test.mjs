import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createAuraVoiceSession } from "../services/auraVoiceService.js";
import { parseAuraIntent } from "../utils/auraIntentParser.js";
import { cleanseAuraInventoryText, matchAuraProduct } from "../utils/auraLingo.js";
import { createAuraConversation, reduceAuraConversation } from "../services/auraConversation.js";
import { mountAuraWidget } from "../components/common/auraVoiceWidget.js";

function fakeRecognitionEnvironment({
  permission = "granted",
  available = "available",
  supportsProcessLocally = true,
} = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://field.example.test/" });
  Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value: "visible" });
  const previous = new Map();
  for (const name of ["window", "document", "navigator"]) previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  const engines = [];
  class FakeRecognition {
    static async available(options) {
      return typeof available === "function" ? available(options) : available;
    }
    constructor() {
      this.aborted = false;
      if (supportsProcessLocally) this.processLocally = false;
      engines.push(this);
    }
    start() { this.started = true; this.onstart?.(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  }
  Object.defineProperty(dom.window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
  Object.defineProperty(dom.window, "speechSynthesis", { configurable: true, value: null });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { permissions: { query: async () => ({ state: permission }) } },
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
  await new Promise((resolve) => setImmediate(resolve));
}

async function chooseAuraStandardFallback() {
  await flush();
  const button = [...document.querySelectorAll(".aura-retry")].find(node => node.textContent === "Use standard lookup");
  assert.ok(button, "the user must explicitly choose the deterministic fallback");
  button.click();
  await flush();
}

function speechResult(transcript, isFinal, confidence = 0.99) {
  const result = [{ transcript, confidence }];
  result.isFinal = isFinal;
  return result;
}

test("chat parser extracts named recipients and blocks department sending", () => {
  assert.deepEqual(parseAuraIntent("Hey Aura, send a message to Megan Kelly saying The truck is at the north gate."), {
    type: "chat",
    recipientType: "person",
    recipientName: "Megan Kelly",
    message: "The truck is at the north gate",
  });
  assert.deepEqual(parseAuraIntent("send a message to Plant Evaluators department saying the bay is ready"), {
    type: "chat",
    recipientType: "department",
    recipientName: "Plant Evaluators department",
    message: "the bay is ready",
  });
});

test("AURA V2 cleans common phonetics and keeps size matching exact", () => {
  assert.equal(cleanseAuraInventoryText("three deep pee Limelight"), "3DP Limelight");
  assert.equal(cleanseAuraInventoryText("hash three Annabelle"), "#3 Annabelle");
  assert.equal(cleanseAuraInventoryText("you one Little Hotties"), "U1 Little Hotties");
  assert.deepEqual(parseAuraIntent("How many three deep pee Little Hotties in U2?"), {
    type: "CHECK_INVENTORY_COUNT", commonName: "Little Hotties", contSize: "3DP", season: "U2", locationCode: null, metric: "ptravailable", openStockOnly: false,
  });
  assert.equal(parseAuraIntent("What item has largest U1 value?").type, "CHECK_INVENTORY_MAX");
  assert.deepEqual(parseAuraIntent("50 three deep pee Limelight", { auraMode: "BUILDING_REQUEST" }), {
    type: "ADD_REQUEST_ITEM", quantity: 50, commonName: "Limelight", contSize: "3DP",
  });
  assert.equal(parseAuraIntent("50 three deep pee Limelight").type, "unknown");
  const catalog = [
    { itemcode: "A", contsize: "3DP", commonname: "Little Hotties" },
    { itemcode: "A", contsize: "#3", commonname: "Little Hotties" },
  ];
  assert.equal(matchAuraProduct({ commonName: "Little Hotties", contSize: "3DP" }, { rows: catalog, complete: true }).kind, "match");
  assert.equal(matchAuraProduct({ commonName: "Little Hotties" }, { rows: [
    ...catalog,
    { itemcode: "B", contsize: "3DP", commonname: "Little Hotties" },
  ], complete: true }).kind, "choose");
});

test("AURA conversation reducer builds, undoes, reviews, and cancels request drafts", () => {
  let state = createAuraConversation();
  state = reduceAuraConversation(state, { type: "STARTED", party: { key: "party-1", customerName: "Megan", label: "Megan" } });
  assert.equal(state.auraMode, "BUILDING_REQUEST");
  state = reduceAuraConversation(state, { type: "LINE_VERIFIED", line: { unique_id: "u1", itemcode: "SKU1", contsize: "3DP", quantity: 50, ptravailable: 50 } });
  assert.equal(state.lines.length, 1);
  state = reduceAuraConversation(state, { type: "UNDO" });
  assert.equal(state.lines.length, 0);
  state = reduceAuraConversation(state, { type: "LINE_VERIFIED", line: { unique_id: "u1", itemcode: "SKU1", contsize: "3DP", quantity: 50, ptravailable: 50 } });
  state = reduceAuraConversation(state, { type: "REVIEW" });
  assert.equal(state.auraMode, "REVIEWING_REQUEST");
  state = reduceAuraConversation(state, { type: "CANCEL" });
  assert.equal(state.auraMode, "IDLE");
});

test("AURA starts only with existing permission and prefers continuous local recognition", async () => {
  const browser = fakeRecognitionEnvironment();
  const recognitions = [];
  const transcripts = [];
  try {
    const session = createAuraVoiceSession({
      onRecognition: event => recognitions.push(event),
      onTranscript: (text, metadata) => transcripts.push({ text, metadata }),
    });
    assert.equal(await session.startIfAllowed(), true);
    assert.equal(browser.engines.length, 1);
    assert.equal(browser.engines[0].continuous, true);
    assert.equal(browser.engines[0].interimResults, true);
    assert.equal(browser.engines[0].processLocally, true);
    browser.engines[0].onresult({ results: [speechResult("hey aura", true)], resultIndex: 0 });
    assert.equal(recognitions[0].recognitionMode, "local");
    assert.equal(recognitions[0].processLocally, true);
    assert.equal(transcripts[0].metadata.recognitionMode, "local");
    assert.equal(transcripts[0].metadata.processLocally, true);
    session.destroy();
  } finally { await browser.restore(); }
});

test("permission denial stays terminal and startIfAllowed never opens browser recognition", async () => {
  const denied = fakeRecognitionEnvironment({ permission: "prompt" });
  try {
    const states = [];
    const session = createAuraVoiceSession({ onState: (state) => states.push(state) });
    assert.equal(await session.startIfAllowed(), false);
    assert.equal(denied.engines.length, 0);
    assert.match(states.at(-1).message, /tap the microphone/i);
    session.destroy();
  } finally { await denied.restore(); }

  const unavailable = fakeRecognitionEnvironment({ available: "downloadable" });
  try {
    const states = [];
    const session = createAuraVoiceSession({ onState: (state) => states.push(state) });
    assert.equal(await session.startIfAllowed(), false);
    assert.equal(unavailable.engines.length, 0);
    assert.equal(states.at(-1).recognitionMode, null);
    assert.match(states.at(-1).message, /tap the microphone for one browser-recognized command/i);
    assert.equal(await session.start(), true, "browser recognition requires the explicit microphone start");
    assert.equal(unavailable.engines.length, 1);
    assert.equal(unavailable.engines[0].processLocally, false);
    assert.equal(unavailable.engines[0].continuous, false);
    assert.equal(unavailable.engines[0].interimResults, true);
    assert.equal(states.at(-1).recognitionMode, "browser");
    assert.match(states.find(state => /using browser speech/i.test(state.message)).message, /may process microphone audio through its provider/i);
    session.destroy();
  } finally { await unavailable.restore(); }
});

test("local-first selection falls back when the engine lacks processLocally support", async () => {
  const browser = fakeRecognitionEnvironment({ supportsProcessLocally: false });
  const states = [];
  try {
    const session = createAuraVoiceSession({ onState: state => states.push(state) });
    assert.equal(await session.start(), true);
    assert.equal(browser.engines.length, 1);
    assert.equal("processLocally" in browser.engines[0], false);
    assert.equal(states.at(-1).recognitionMode, "browser");
    assert.match(states.find(state => /using browser recognition/i.test(state.message)).message, /provider/i);
    session.destroy();
  } finally { await browser.restore(); }
});

test("browser fallback is selected when local capability probing times out and late completion cannot switch modes", async () => {
  let resolveCapability;
  const browser = fakeRecognitionEnvironment({
    available: () => new Promise(resolve => { resolveCapability = resolve; }),
  });
  const states = [];
  const recognitions = [];
  const transcripts = [];
  try {
    const session = createAuraVoiceSession({
      localCapabilityTimeoutMs: 5,
      onState: state => states.push(state),
      onRecognition: event => recognitions.push(event),
      onTranscript: (text, metadata) => transcripts.push({ text, metadata }),
    });
    assert.equal(await session.start(), true);
    assert.equal(browser.engines.length, 1);
    assert.equal(browser.engines[0].processLocally, false);
    assert.equal(states.at(-1).recognitionMode, "browser");
    resolveCapability("available");
    browser.engines[0].onresult({ results: [speechResult("hey aura", true)], resultIndex: 0 });
    assert.equal(recognitions[0].recognitionMode, "browser");
    assert.equal(recognitions[0].processLocally, false);
    assert.equal(recognitions[0].recognitionId, recognitions[0].epoch);
    browser.engines[0].onend();
    assert.equal(transcripts[0].metadata.recognitionMode, "browser");
    assert.equal(transcripts[0].metadata.processLocally, false);
    assert.equal(transcripts[0].metadata.completionSource, "final");
    session.destroy();
  } finally { await browser.restore(); }
});

test("missing local capability API selects browser mode without attempting pack installation", async () => {
  const browser = fakeRecognitionEnvironment();
  class NoLocalProbe extends browser.dom.window.SpeechRecognition {
    static available = undefined;
  }
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: NoLocalProbe });
  try {
    const session = createAuraVoiceSession();
    assert.equal(await session.start(), true);
    assert.equal(browser.engines.length, 1);
    assert.equal(browser.engines[0].processLocally, false);
    session.destroy();
  } finally { await browser.restore(); }
});

test("prefixed browser recognition constructor remains supported", async () => {
  const browser = fakeRecognitionEnvironment();
  const prefixed = browser.dom.window.SpeechRecognition;
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: prefixed });
  try {
    const session = createAuraVoiceSession();
    assert.equal(await session.start(), true);
    assert.equal(browser.engines.length, 1);
    assert.equal(browser.engines[0].processLocally, true);
    session.destroy();
  } finally { await browser.restore(); }
});

test("a runtime local-mode change stops input without switching providers", async () => {
  const browser = fakeRecognitionEnvironment();
  const states = [];
  try {
    const session = createAuraVoiceSession({ onState: state => states.push(state) });
    assert.equal(await session.start(), true);
    const engine = browser.engines[0];
    engine.processLocally = false;
    engine.onresult({ results: [speechResult("hey aura", true)], resultIndex: 0 });
    assert.equal(browser.engines.length, 1);
    assert.equal(session.enabled, false);
    assert.equal(states.at(-1).status, "unavailable");
    session.destroy();
  } finally { await browser.restore(); }
});

test("a deliberate new start reselects recognition mode after stop", async () => {
  let available = "downloadable";
  const browser = fakeRecognitionEnvironment({ available: () => available });
  try {
    const session = createAuraVoiceSession();
    assert.equal(await session.start(), true);
    assert.equal(browser.engines[0].processLocally, false);
    session.stop();
    available = "available";
    assert.equal(await session.start(), true);
    assert.equal(browser.engines[1].processLocally, true);
    session.destroy();
  } finally { await browser.restore(); }
});

test("AURA pauses while hidden and requires an explicit foreground resume", async () => {
  const browser = fakeRecognitionEnvironment();
  try {
    const session = createAuraVoiceSession();
    await session.startIfAllowed();
    const first = browser.engines[0];
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(first.aborted, true);
    assert.equal(session.enabled, false);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    await flush();
    assert.equal(browser.engines.length, 1);
    assert.equal(await session.startIfAllowed(), true);
    assert.equal(browser.engines.length, 2);
    session.destroy();
  } finally { await browser.restore(); }
});

test("a late local capability result cannot restart recognition after Stop", async () => {
  const browser = fakeRecognitionEnvironment();
  let resolveCapability;
  class DeferredRecognition extends browser.dom.window.SpeechRecognition {
    static available() { return new Promise(resolve => { resolveCapability = resolve; }); }
  }
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: DeferredRecognition });
  try {
    const session = createAuraVoiceSession();
    const starting = session.start();
    await flush();
    session.stop();
    resolveCapability("available");
    assert.equal(await starting, false);
    assert.equal(browser.engines.length, 0);
    assert.equal(session.enabled, false);
    session.destroy();
  } finally { await browser.restore(); }
});

test("a visibility change while local capability is pending fences the stale start", async () => {
  const browser = fakeRecognitionEnvironment();
  let resolveCapability;
  class DeferredRecognition extends browser.dom.window.SpeechRecognition {
    static available() { return new Promise(resolve => { resolveCapability = resolve; }); }
  }
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: DeferredRecognition });
  try {
    const session = createAuraVoiceSession();
    const starting = session.start();
    await flush();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    resolveCapability("available");
    assert.equal(await starting, false);
    assert.equal(browser.engines.length, 0);
    assert.equal(session.enabled, false);
    session.destroy();
  } finally { await browser.restore(); }
});

test("busy work suppresses recognition restart until the operation releases it", async () => {
  const browser = fakeRecognitionEnvironment();
  try {
    const session = createAuraVoiceSession();
    await session.start();
    session.setBusy(true);
    assert.equal(browser.engines[0].aborted, true);
    assert.equal(browser.engines.length, 1);
    session.setBusy(false);
    await flush();
    assert.equal(browser.engines.length, 2);
    session.destroy();
  } finally { await browser.restore(); }
});

test("busy browser turns end and do not automatically restart", async () => {
  const browser = fakeRecognitionEnvironment({ available: "downloadable" });
  const states = [];
  try {
    const session = createAuraVoiceSession({ onState: state => states.push(state) });
    assert.equal(await session.start(), true);
    assert.equal(browser.engines[0].processLocally, false);
    session.setBusy(true);
    assert.equal(await session.start(), false);
    assert.equal(await session.startIfAllowed(), false);
    session.setBusy(false);
    await flush();
    assert.equal(browser.engines.length, 1);
    assert.equal(session.enabled, false);
    assert.equal(states.at(-1).recognitionMode, "browser");
    session.destroy();
  } finally { await browser.restore(); }
});

test("busy during a pending capability probe fences it without a late engine start", async () => {
  const browser = fakeRecognitionEnvironment();
  const resolvers = [];
  class DeferredRecognition extends browser.dom.window.SpeechRecognition {
    static available() {
      return new Promise(resolve => resolvers.push(resolve));
    }
  }
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: DeferredRecognition });
  try {
    const session = createAuraVoiceSession({ localCapabilityTimeoutMs: 1000 });
    const firstStart = session.start();
    await flush();
    assert.equal(resolvers.length, 1);
    session.setBusy(true);
    session.setBusy(false);
    await flush();
    resolvers[0]("available");
    await firstStart;
    await flush();
    assert.equal(browser.engines.length, 0);
    assert.equal(session.enabled, false);
    session.destroy();
  } finally { await browser.restore(); }
});

test("browser recognition is a one-shot final turn and fences duplicate and late results", async () => {
  const browser = fakeRecognitionEnvironment({ available: "downloadable" });
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  let fakeNow = 0;
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, due: fakeNow + delay, cancelled: false };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = timer => { if (timer) timer.cancelled = true; };
  const states = [];
  const recognitions = [];
  const transcripts = [];
  let session;
  let enabledDuringCallback = true;
  try {
    session = createAuraVoiceSession({
      onState: state => states.push(state),
      onRecognition: event => { recognitions.push(event); enabledDuringCallback = session.enabled; },
      onTranscript: (text, meta) => transcripts.push({ text, meta }),
    });
    assert.equal(await session.start(), true);
    assert.equal(browser.engines[0].processLocally, false);
    assert.equal(browser.engines[0].continuous, false);
    assert.equal(browser.engines[0].interimResults, true);
    browser.engines[0].onresult({ results: [speechResult("check inventory", false)], resultIndex: 0 });
    assert.equal(recognitions.length, 1, "interim output may be shown but is not a final command");
    const lateResult = browser.engines[0].onresult;
    const lateEnd = browser.engines[0].onend;
    const lateError = browser.engines[0].onerror;
    const finalHandler = browser.engines[0].onresult;
    const result = { results: [speechResult("check inventory", true)], resultIndex: 0 };
    finalHandler(result);
    finalHandler(result);
    assert.equal(recognitions.length, 3, "all transcript events are previewed");
    assert.equal(transcripts.length, 0, "preview events do not submit commands");
    assert.equal(enabledDuringCallback, true, "the recognizer remains active until it ends");
    browser.engines[0].onend();
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].text, "check inventory");
    assert.equal(transcripts[0].meta.completionSource, "final");
    assert.equal(session.enabled, false);
    assert.equal(session.listening, false);
    assert.equal(states.at(-1).recognitionMode, "browser", "the provider label remains after the turn");
    assert.match(states.at(-1).message, /one browser-recognized command captured/i);
    assert.equal(browser.engines.length, 1, "duplicate final and onend events cannot restart");
    lateResult(result);
    lateEnd();
    lateError({ error: "network" });
    const targetTime = fakeNow + 11_000;
    while (true) {
      const next = timers.filter(timer => !timer.cancelled && timer.due <= targetTime).sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      next.cancelled = true;
      fakeNow = next.due;
      next.callback();
      await flush();
    }
    fakeNow = targetTime;
    assert.equal(browser.engines.length, 1, "no browser restart is scheduled within eleven seconds");
    assert.equal(recognitions.length, 3);
    assert.equal(transcripts.length, 1);
    assert.equal(await session.startIfAllowed(), false, "the automatic path remains local-only");
    assert.equal(browser.engines.length, 1);
    session.destroy();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    await browser.restore();
  }
});

test("an empty browser final result ends the turn without delivering a transcript", async () => {
  const browser = fakeRecognitionEnvironment({ available: "downloadable" });
  const states = [];
  const transcripts = [];
  try {
    const session = createAuraVoiceSession({
      onState: state => states.push(state),
      onTranscript: (text, metadata) => transcripts.push({ text, metadata }),
    });
    assert.equal(await session.start(), true);
    browser.engines[0].onresult({ results: [speechResult("", true)], resultIndex: 0 });
    browser.engines[0].onend();
    assert.equal(session.enabled, false);
    assert.equal(browser.engines.length, 1);
    assert.deepEqual(transcripts, []);
    assert.equal(states.at(-1).status, "idle");
    assert.match(states.at(-1).message, /no command was captured/i);
    session.destroy();
  } finally { await browser.restore(); }
});

test("browser errors cancel turns; low-confidence final text remains available with diagnostic metadata", async () => {
  for (const errorName of ["no-speech", "network"]) {
    const browser = fakeRecognitionEnvironment({ available: "downloadable" });
    const states = [];
    try {
      const session = createAuraVoiceSession({ onState: state => states.push(state) });
      assert.equal(await session.start(), true);
      browser.engines[0].onerror({ error: errorName });
      browser.engines[0].onend?.();
      await flush();
      assert.equal(session.enabled, false);
      assert.equal(browser.engines.length, 1);
      assert.equal(states.at(-1).recognitionMode, "browser");
      assert.match(states.at(-1).message, errorName === "no-speech" ? /no speech was captured/i : /network problem/i);
      session.destroy();
    } finally { await browser.restore(); }
  }

  const browser = fakeRecognitionEnvironment({ available: "downloadable" });
  const states = [];
  const transcripts = [];
  try {
    const session = createAuraVoiceSession({
      minimumConfidence: 0.8,
      onState: state => states.push(state),
      onTranscript: (text, metadata) => transcripts.push({ text, metadata }),
    });
    assert.equal(await session.start(), true);
    browser.engines[0].onresult({ results: [speechResult("maybe", true, 0.2)], resultIndex: 0 });
    assert.equal(session.enabled, true, "the provider end event completes the turn");
    assert.equal(browser.engines.length, 1);
    assert.equal(transcripts.length, 0);
    browser.engines[0].onend();
    assert.equal(transcripts[0].text, "maybe", "captured speech is retained regardless of confidence");
    assert.equal(transcripts[0].metadata.lowConfidence, true);
    assert.equal(transcripts[0].metadata.completionSource, "final");
    assert.equal(states.at(-1).status, "idle");
    assert.equal(states.at(-1).recognitionMode, "browser");
    session.destroy();
  } finally { await browser.restore(); }
});

test("low-confidence local results retain the existing noise gate", async () => {
  const browser = fakeRecognitionEnvironment({ available: "available" });
  const recognitions = [];
  const transcripts = [];
  try {
    const session = createAuraVoiceSession({
      minimumConfidence: 0.8,
      onRecognition: event => recognitions.push(event),
      onTranscript: text => transcripts.push(text),
    });
    await session.startIfAllowed();
    browser.engines[0].onresult({ results: [speechResult("unclear local words", true, 0.2)], resultIndex: 0 });
    assert.equal(recognitions.length, 0);
    assert.deepEqual(transcripts, []);
    session.destroy();
  } finally { await browser.restore(); }
});

test("browser transcript preview replaces interim text, preserves final segments, and submits once on end", async () => {
  const browser = fakeRecognitionEnvironment({ available: "downloadable" });
  const previews = [];
  const transcripts = [];
  try {
    const session = createAuraVoiceSession({
      onRecognition: event => previews.push(event),
      onTranscript: (text, metadata) => transcripts.push({ text, metadata }),
    });
    await session.start();
    const engine = browser.engines[0];
    engine.onresult({ results: [speechResult("baby gem", false, 0), speechResult("box", false, 0)], resultIndex: 0 });
    engine.onresult({ results: [speechResult("baby gem boxwood", false, 0)], resultIndex: 0 });
    assert.equal(previews[0].previewText, "baby gem box");
    assert.equal(previews[1].previewText, "baby gem boxwood", "replacement interim supersedes old and removed interim segments");
    assert.equal(previews[0].phase, "preview");
    assert.equal(previews[1].lowConfidence, true);
    assert.equal(transcripts.length, 0, "previewing never submits a command");

    engine.onresult({ results: [
      speechResult("How many", true, 0),
      speechResult("3DP baby gem boxwood", true, 0),
    ], resultIndex: 0 });
    assert.equal(previews.at(-1).previewText, "How many 3DP baby gem boxwood");
    const endHandler = engine.onend;
    endHandler();
    endHandler();
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].text, "How many 3DP baby gem boxwood");
    assert.equal(transcripts[0].metadata.completionSource, "final");
    assert.equal(transcripts[0].metadata.isFinal, true);
    assert.equal(transcripts[0].metadata.confidence, 0);
    session.destroy();
  } finally { await browser.restore(); }
});

test("browser speechend stops recognition and submits interim-only text after its one-second deadline", async () => {
  const browser = fakeRecognitionEnvironment({ available: "downloadable" });
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cancelled: false };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = timer => { if (timer) timer.cancelled = true; };
  const transcripts = [];
  try {
    const session = createAuraVoiceSession({ onTranscript: (text, metadata) => transcripts.push({ text, metadata }) });
    await session.start();
    const engine = browser.engines[0];
    engine.onresult({ results: [speechResult("How many 3DP baby gem boxwood are in open stock", false, 0)], resultIndex: 0 });
    engine.onspeechend();
    assert.equal(engine.stopped, true, "speech end requests final results with stop(), not abort()");
    assert.equal(engine.aborted, false);
    assert.equal(transcripts.length, 0);
    const deadline = timers.find(timer => timer.delay === 1000);
    assert.ok(deadline);
    deadline.callback();
    assert.equal(engine.aborted, true, "the safety deadline releases a recognizer that ignored stop()");
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].text, "How many 3DP baby gem boxwood are in open stock");
    assert.equal(transcripts[0].metadata.completionSource, "interim_end");
    assert.equal(transcripts[0].metadata.isFinal, false);
    const lateEnd = engine.onend;
    lateEnd?.();
    assert.equal(transcripts.length, 1, "late onend cannot submit a second command");
    assert.equal(browser.engines.length, 1, "browser mode never auto-restarts");
    session.destroy();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    await browser.restore();
  }
});

test("Stop and page hide cancel pending browser finalization without submitting preview text", async () => {
  for (const cancel of ["stop", "hide"]) {
    const browser = fakeRecognitionEnvironment({ available: "downloadable" });
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timers = [];
    globalThis.setTimeout = (callback, delay) => {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    };
    globalThis.clearTimeout = timer => { if (timer) timer.cancelled = true; };
    const transcripts = [];
    try {
      const session = createAuraVoiceSession({ onTranscript: text => transcripts.push(text) });
      await session.start();
      const engine = browser.engines[0];
      engine.onresult({ results: [speechResult("do not submit", false)], resultIndex: 0 });
      engine.onspeechend();
      const deadline = timers.find(timer => timer.delay === 1000);
      assert.ok(deadline);
      if (cancel === "stop") session.stop();
      else {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new window.Event("visibilitychange"));
      }
      deadline.callback();
      engine.onend?.();
      assert.deepEqual(transcripts, []);
      assert.equal(engine.aborted, true, "cancellation aborts rather than gracefully finalizing");
      session.destroy();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      await browser.restore();
    }
  }
});

test("browser end without a final utterance terminates instead of restarting", async () => {
  const browser = fakeRecognitionEnvironment({ available: "downloadable" });
  const states = [];
  try {
    const session = createAuraVoiceSession({ onState: state => states.push(state) });
    assert.equal(await session.start(), true);
    browser.engines[0].onend();
    assert.equal(session.enabled, false);
    assert.equal(browser.engines.length, 1);
    assert.equal(states.at(-1).recognitionMode, "browser");
    assert.match(states.at(-1).message, /no command was captured/i);
    session.destroy();
  } finally { await browser.restore(); }
});

test("Stop fences a late synthesis completion from restarting the microphone", async () => {
  const browser = fakeRecognitionEnvironment();
  try {
    const utterances = [];
    class FakeUtterance { constructor(text) { this.text = text; } }
    const synthesis = {
      getVoices: () => [{ name: "Google US English", lang: "en-US", localService: true }],
      cancel() {},
      speak(utterance) { utterances.push(utterance); },
    };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
    const session = createAuraVoiceSession();
    await session.start();
    assert.equal(session.speak("Working."), true);
    session.stop();
    utterances[0].onend();
    await flush();
    assert.equal(browser.engines.length, 1);
    assert.equal(session.enabled, false);
    session.destroy();
  } finally { await browser.restore(); }
});

test("onend restart uses capped exponential delay and stops after repeated failures", async () => {
  const browser = fakeRecognitionEnvironment();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cancelled: false };
    scheduled.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => { if (timer) timer.cancelled = true; };
  try {
    const states = [];
    const session = createAuraVoiceSession({ onState: (state) => states.push(state) });
    await session.startIfAllowed();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      browser.engines.at(-1).onend();
      const timer = scheduled.at(-1);
      assert.equal(timer.cancelled, false);
      timer.callback();
      await flush();
    }
    browser.engines.at(-1).onend();
    assert.equal(session.enabled, false);
    assert.match(states.at(-1).message, /repeated interruptions/i);
    assert.equal(scheduled[0].delay, 2000, "local capability probing is bounded at two seconds");
    assert.equal(scheduled[0].cancelled, true, "successful capability probes clear the timeout");
    assert.deepEqual(scheduled.slice(1).map((timer) => timer.delay), [700, 1400, 2800, 5600, 10000]);
    assert.equal(await session.start(), true, "an explicit new start resets the restart budget");
    assert.equal(browser.engines.length, 7);
    session.destroy();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    await browser.restore();
  }
});

test("wake-word widget waits for a final command and sends a named chat exactly once", async () => {
  const browser = fakeRecognitionEnvironment();
  const sent = [];
  try {
    const widget = mountAuraWidget({
      isAuthorized: () => true,
      sendMessage: async (intent, options) => {
        sent.push({ intent, options });
        return { ok: true, recipientName: intent.recipientName };
      },
    });
    document.querySelector(".aura-fab").click();
    document.querySelector(".aura-mic").click();
    await flush();
    const engine = browser.engines[0];
    const onresult = engine.onresult;
    onresult({ results: [speechResult("Hey Aura", false)], resultIndex: 0 });
    onresult({ results: [speechResult("Hey Aura", true)], resultIndex: 0 });
    onresult({ results: [
      speechResult("Hey Aura", true),
      speechResult("send a message to Megan Kelly saying The order is staged", false),
    ], resultIndex: 1 });
    assert.equal(sent.length, 0);
    const finalResults = [
      speechResult("Hey Aura", true),
      speechResult("send a message to Megan Kelly saying The order is staged", true),
    ];
    onresult({ results: finalResults, resultIndex: 1 });
    await flush();
    onresult({ results: finalResults, resultIndex: 1 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].intent.recipientName, "Megan Kelly");
    assert.equal(sent[0].intent.message, "The order is staged");
    assert.ok(sent[0].options.idempotencyKey);
    widget.destroy();
  } finally { await browser.restore(); }
});

test("department chat intent returns a no-send response", async () => {
  const browser = fakeRecognitionEnvironment();
  const sent = [];
  try {
    const widget = mountAuraWidget({
      isAuthorized: () => true,
      sendMessage: async (...args) => { sent.push(args); return { ok: true }; },
    });
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    input.value = "send a message to the Sales department saying trucks are ready";
    document.querySelector(".aura-inputbar button[type=submit]").click();
    await flush();
    assert.equal(sent.length, 0);
    assert.match(document.querySelector(".aura-message").textContent, /didn’t send anything/i);
    widget.destroy();
  } finally { await browser.restore(); }
});

test("AURA V2 builds a multi-turn draft and opens review without submitting", async () => {
  const browser = fakeRecognitionEnvironment();
  const calls = [];
  let staged = null;
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async (name) => ({ items: [{ key: "party-1", customerName: name, label: name }], hasMore: false }),
    requestV2: async (body) => {
      calls.push(body);
      if (body.operation === "match") return { ok: true, rows: [{ itemcode: "SKU-1", commonname: "Limelight", contsize: "3DP", matchKind: "exact" }], complete: true, exactMatch: true, additionalMatches: false, hasMore: false, season: "U2", salesYear: 27 };
      if (body.operation === "lots") return { ok: true, rows: [{ unique_id: "uid-1", itemcode: "SKU-1", commonname: "Limelight", contsize: "3DP", locationcode: "U2", lotcode: "27.U2", ptravailable: 80 }], complete: true, hasMore: false };
      throw new Error(`Unexpected operation ${body.operation}`);
    },
    openDraft: async (draft) => { staged = draft; return { ok: true, message: "Draft is open for review." }; },
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    const submit = document.querySelector(".aura-inputbar button[type=submit]");
    input.value = "start a request for Megan"; submit.click(); await flush();
    assert.match(document.querySelector(".aura-message").textContent, /request started for Megan/i);
    input.value = "50 three deep pee Limelight"; submit.click(); await flush();
    await chooseAuraStandardFallback();
    assert.equal(calls.filter((call) => call.operation === "match").length, 1);
    assert.equal(calls.at(-1).operation, "lots", document.querySelector(".aura-message").textContent);
    assert.equal(calls.at(-1).itemcode, "SKU-1");
    assert.equal(calls.at(-1).quantity, 50);
    assert.match(document.querySelector(".aura-message").textContent, /added 50 3DP Limelight/i);
    input.value = "review request"; submit.click(); await flush();
    assert.equal(staged.party.key, "party-1");
    assert.equal(staged.lines[0].unique_id, "uid-1");
    assert.equal(staged.lines[0].quantity, 50);
    assert.match(document.querySelector(".aura-message").textContent, /open for review/i);
  } finally { widget.destroy(); await browser.restore(); }
});

test("AURA V2 rechecks cumulative SKU quantities and handles zero counts without inventing values", async () => {
  const browser = fakeRecognitionEnvironment();
  const calls = [];
  let handedOff;
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async (name) => ({ items: [{ key: "party-2", customerName: name, label: name }], hasMore: false }),
    requestV2: async (body) => {
      calls.push(body);
      if (body.operation === "match") return { ok: true, rows: [{ itemcode: "SKU-2", commonname: "Limelight", contsize: "3DP", matchKind: "exact" }], complete: true, exactMatch: true, additionalMatches: false, hasMore: false };
      if (body.operation === "lots") return { ok: true, rows: [{ unique_id: "lot-u", itemcode: "SKU-2", commonname: "Limelight", contsize: "3DP", locationcode: "A.01", lotcode: "27.U2", ptravailable: 70 }], complete: true, hasMore: false };
      if (body.operation === "count") return { ok: true, total: 0, complete: true, rows: [], metric: "ptravailable" };
      throw new Error(`Unexpected operation ${body.operation}`);
    },
    openDraft: async (draft) => { handedOff = draft; return { ok: true, message: "Draft ready." }; },
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    const submit = document.querySelector(".aura-inputbar button[type=submit]");
    input.value = "start a request for Megan"; submit.click(); await flush();
    input.value = "30 3DP Limelight"; submit.click(); await flush();
    await chooseAuraStandardFallback();
    input.value = "20 3DP Limelight"; submit.click(); await flush();
    await chooseAuraStandardFallback();
    assert.deepEqual(calls.filter(call => call.operation === "lots").map(call => call.quantity), [30, 50]);
    input.value = "review request"; submit.click(); await flush();
    assert.equal(handedOff.lines.length, 1);
    assert.equal(handedOff.lines[0].quantity, 50);
    widget.destroy();

    const queryWidget = mountAuraWidget({
      isAuthorized: () => true,
      requestV2: async (body) => {
        if (body.operation === "match") return { ok: true, rows: [{ itemcode: "SKU-2", commonname: "Limelight", contsize: "3DP", matchKind: "exact" }], complete: true, exactMatch: true, additionalMatches: false, hasMore: false };
        if (body.operation === "count") return { ok: true, total: 0, complete: true, rows: [], metric: "ptravailable" };
        if (body.operation === "maximum") return { ok: true, complete: true, winner: { commonname: "Limelight", contsize: "3DP", total: 12 } };
        throw new Error(`Unexpected operation ${body.operation}`);
      },
    });
    const queryInput = document.querySelector(".aura-inputbar input");
    const querySubmit = document.querySelector(".aura-inputbar button[type=submit]");
    queryInput.value = "How many 3DP Limelight in U2"; querySubmit.click(); await flush();
    await chooseAuraStandardFallback();
    assert.match(document.querySelector(".aura-message").textContent, /^0 3DP Limelight for U2 available\.$/i);
    queryInput.value = "What item has largest U1 value"; querySubmit.click(); await flush();
    assert.match(document.querySelector(".aura-message").textContent, /largest U1 available value is Limelight/i);
    queryWidget.destroy();
  } finally { widget.destroy(); await browser.restore(); }
});

test("AURA V2 accepts follow-up items without another wake word and consumes final results once", async () => {
  const browser = fakeRecognitionEnvironment();
  const calls = [];
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async (name) => ({ items: [{ key: "party-v", customerName: name, label: name }], hasMore: false }),
    requestV2: async (body) => {
      calls.push(body);
      if (body.operation === "match") return { ok: true, rows: [{ itemcode: "V1", commonname: "Limelight", contsize: "3DP", matchKind: "exact" }], complete: true, exactMatch: true, additionalMatches: false, hasMore: false };
      if (body.operation === "lots") return { ok: true, rows: [{ unique_id: "v-lot", itemcode: "V1", commonname: "Limelight", contsize: "3DP", ptravailable: 150 }], complete: true, hasMore: false };
      throw new Error(`Unexpected operation ${body.operation}`);
    },
  });
  try {
    document.querySelector(".aura-fab").click();
    document.querySelector(".aura-mic").click(); await flush();
    const engine = browser.engines[0];
    const onresult = engine.onresult;
    onresult({ results: [speechResult("Hey Aura, start a request for Megan", true)], resultIndex: 0 });
    await flush();
    const followupEngine = browser.engines.at(-1);
    followupEngine.onresult({ results: [speechResult("50 three deep pee Limelight", true)], resultIndex: 0 });
    await flush();
    await chooseAuraStandardFallback();
    assert.deepEqual(calls.filter(call => call.operation === "lots").map(call => call.quantity), [50], document.querySelector(".aura-message")?.textContent);
    assert.match(document.querySelector(".aura-message").textContent, /added 50 3DP Limelight/i);
    const repeatedIntentEngine = browser.engines.at(-1);
    repeatedIntentEngine.onresult({ results: [speechResult("50 three deep pee Limelight", true)], resultIndex: 0 });
    await flush();
    await chooseAuraStandardFallback();
    assert.deepEqual(calls.filter(call => call.operation === "lots").map(call => call.quantity), [50, 100]);
    assert.match(document.querySelector(".aura-message").textContent, /updated the request to 100 3DP Limelight/i);
  } finally { widget.destroy(); await browser.restore(); }
});

test("AURA V2 exposes explicit ambiguity choices and accepts a one-digit choice", async () => {
  const browser = fakeRecognitionEnvironment();
  const lotCalls = [];
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async (name) => ({ items: [{ key: "party-choice", customerName: name, label: name }], hasMore: false }),
    requestV2: async (body) => {
      if (body.operation === "match") return { ok: true, complete: true, exactMatch: false, additionalMatches: false, hasMore: false, rows: [
        { itemcode: "SKU-A", commonname: "Limelight", contsize: "3DP", matchKind: "exact" },
        { itemcode: "SKU-B", commonname: "Limelight", contsize: "3DP", matchKind: "exact" },
      ] };
      if (body.operation === "lots") {
        lotCalls.push(body.itemcode);
        return { ok: true, complete: true, hasMore: false, rows: [{ unique_id: "lot-b", itemcode: body.itemcode, commonname: "Limelight", contsize: "3DP", ptravailable: 60 }] };
      }
      throw new Error(`Unexpected operation ${body.operation}`);
    },
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    const submit = document.querySelector('.aura-inputbar button[type="submit"]');
    input.value = "start a request for Megan"; submit.click(); await flush();
    input.value = "50 3DP Limelight"; submit.click(); await flush();
    await chooseAuraStandardFallback();
    assert.equal(document.querySelectorAll(".aura-choice").length, 2);
    input.value = "2"; submit.click(); await flush();
    assert.deepEqual(lotCalls, ["SKU-B"]);
    assert.match(document.querySelector(".aura-message").textContent, /added 50 3DP Limelight/i);
  } finally { widget.destroy(); await browser.restore(); }
});

test("typed request drafts pause after two quiet minutes and expose Resume", async () => {
  const browser = fakeRecognitionEnvironment();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cancelled: false };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => { if (timer) timer.cancelled = true; };
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async (name) => ({ items: [{ key: "party-idle", customerName: name, label: name }], hasMore: false }),
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    input.value = "start a request for Megan";
    document.querySelector('.aura-inputbar button[type="submit"]').click();
    await flush();
    const idleTimer = timers.find(timer => timer.delay === 120_000 && !timer.cancelled);
    assert.ok(idleTimer, "typed interaction must arm the inactivity timer");
    idleTimer.callback();
    assert.match(document.querySelector(".aura-message").textContent, /paused after two quiet minutes/i);
    assert.equal(document.querySelectorAll(".aura-action").length > 0, true);
    assert.match(document.body.textContent, /Resume request/);
  } finally {
    widget.destroy();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    await browser.restore();
  }
});

test("Resume restores ambiguous choices and local voice without a new wake phrase", async () => {
  const browser = fakeRecognitionEnvironment();
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async () => ({ items: [
      { key: "north", customerName: "Acme", label: "Acme North" },
      { key: "south", customerName: "Acme", label: "Acme South" },
    ], hasMore: false }),
  });
  try {
    document.querySelector(".aura-fab").click();
    document.querySelector(".aura-inputbar input").value = "start a request for Acme";
    document.querySelector('.aura-inputbar button[type="submit"]').click(); await flush();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    [...document.querySelectorAll("button")].find(button => button.textContent === "Resume request").click();
    await flush();
    assert.equal(document.querySelectorAll(".aura-choice").length, 2);
    assert.equal(browser.engines.at(-1)?.started, true);
    browser.engines.at(-1).onresult({ results: [speechResult("2", true)], resultIndex: 0 }); await flush();
    assert.match(document.querySelector(".aura-message").textContent, /Acme South/);
  } finally { widget.destroy(); await browser.restore(); }
});

test("AURA speech pauses local recognition and resumes after the response", async () => {
  const browser = fakeRecognitionEnvironment();
  try {
    let spoken;
    class FakeUtterance { constructor(text) { this.text = text; } }
    const synthesis = {
      getVoices: () => [{ name: "Google US English", lang: "en-US", localService: true }],
      cancel() {},
      speak(utterance) { spoken = utterance; },
    };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
    const session = createAuraVoiceSession();
    await session.startIfAllowed();
    assert.equal(session.speak("Ready."), true);
    assert.equal(browser.engines[0].aborted, true);
    spoken.onend();
    await flush();
    assert.equal(browser.engines.length, 2);
    session.destroy();
  } finally { await browser.restore(); }
});

test("AURA speech does not restart a browser one-shot after TTS completes", async () => {
  const browser = fakeRecognitionEnvironment({ available: "downloadable" });
  let spoken;
  class FakeUtterance { constructor(text) { this.text = text; } }
  const synthesis = {
    getVoices: () => [{ name: "Google US English", lang: "en-US", localService: true }],
    cancel() {},
    speak(utterance) { spoken = utterance; },
  };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
  try {
    const states = [];
    const session = createAuraVoiceSession({ onState: state => states.push(state) });
    assert.equal(await session.start(), true);
    assert.equal(session.speak("Ready."), true);
    assert.equal(session.enabled, false);
    spoken.onend();
    await flush();
    assert.equal(browser.engines.length, 1);
    assert.equal(session.enabled, false);
    assert.equal(states.at(-1).recognitionMode, "browser");
    assert.match(states.at(-1).message, /one-shot/i);
    session.destroy();
  } finally { await browser.restore(); }
});

test("AURA sends typed inventory language to the authenticated router and renders verified results", async () => {
  const browser = fakeRecognitionEnvironment();
  const calls = [];
  const row = { unique_id: "lot-1", itemcode: "SKU-1", commonname: "Limelight", contsize: "3DP", locationcode: "U2", lotcode: "27.U2", ptravailable: 80, ptronhand: 90 };
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    requestLlm: async body => {
      calls.push(body);
      return { ok: true, requestId: body.turnId, reply: "I found Limelight.", actions: [{ type: "inventory_result", operation: "open_stock", data: { complete: true, total: 80, rows: [row] } }] };
    },
    requestV2: async () => { throw new Error("The legacy inventory path must not run automatically."); },
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    input.value = "How many Limelight three deep pee do we have in open stock?";
    document.querySelector('.aura-inputbar button[type="submit"]').click();
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, "command");
    assert.equal(calls[0].text, input.value);
    assert.equal(calls[0].source, "typed");
    assert.deepEqual(calls[0].context.draftLines, []);
    assert.deepEqual(calls[0].context.selectedRows, []);
    assert.equal(Object.hasOwn(calls[0].context, "mode"), false);
    assert.equal(document.querySelectorAll(".aura-row").length, 1, document.querySelector(".aura-message").textContent);
    assert.match(document.querySelector(".aura-message").textContent, /found Limelight/i);
  } finally { widget.destroy(); await browser.restore(); }
});

test("AURA sends selected SKU and cumulative draft context using only router-approved fields", async () => {
  const browser = fakeRecognitionEnvironment();
  const calls = [];
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    requestLlm: async body => {
      calls.push(body);
      return calls.length === 1
        ? { ok: true, requestId: body.turnId, reply: "Choose the exact product.", actions: [{ type: "choices", kind: "inventory", complete: true, items: [{ itemcode: "SKU-1", commonname: "Limelight", contsize: "3DP" }] }] }
        : { ok: true, requestId: body.turnId, reply: "The inventory result is incomplete.", actions: [] };
    },
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    const submit = document.querySelector('.aura-inputbar button[type="submit"]');
    input.value = "Find Limelight 3DP"; submit.click(); await flush();
    document.querySelector(".aura-choice").click();
    input.value = "How many of the selected plant do we have?"; submit.click(); await flush();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].context.selectedRows, [{ unique_id: "", itemcode: "SKU-1", commonname: "Limelight", contsize: "3DP", locationcode: "", lotcode: "", quantity: null }]);
    assert.equal(calls[1].context.sku, "SKU-1");
    assert.equal(calls[1].context.size, "3DP");
    assert.deepEqual(calls[1].context.draftLines, []);
    assert.deepEqual(Object.keys(calls[1].context).sort(), ["draftLines", "locationCode", "selectedRows", "size", "sku"].sort());
  } finally { widget.destroy(); await browser.restore(); }
});

test("AURA binds the locally selected party out of band and strips its names from draft utterances", async () => {
  const browser = fakeRecognitionEnvironment();
  const binds = [];
  const commands = [];
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async name => ({ items: [{ key: "acme-key", customerName: "Acme", consigneeName: "North", label: "Acme North", customerIdentityId: "cust-1", consigneeIdentityId: "cons-1" }], hasMore: false }),
    bindParty: async party => { binds.push(party); return { partyRef: `${Date.now() + 60_000}.opaque-party-ref` }; },
    requestLlm: async body => {
      commands.push(body);
      const line = { unique_id: "lot-1", itemcode: "SKU-1", commonname: "Limelight", contsize: "3DP", locationcode: "U2", lotcode: "27.U2", ptravailable: 90, quantity: commands.length === 1 ? 10 : 15 };
      return { ok: true, requestId: body.turnId, reply: "Ready to prepare that draft.", actions: [{ type: "draft_update", lines: [line] }] };
    },
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    const submit = document.querySelector('.aura-inputbar button[type="submit"]');
    input.value = "start a request for Acme North"; submit.click(); await flush();
    input.value = "add 10 three deep pee Limelight for Acme North"; submit.click(); await flush();
    assert.equal(binds.length, 1);
    assert.equal(binds[0].customerIdentityId, "cust-1");
    assert.equal(binds[0].consigneeIdentityId, "cons-1");
    assert.equal(commands.length, 1);
    assert.match(commands[0].partyRef, /^\d{13}\.opaque-party-ref$/);
    assert.deepEqual(commands[0].partySidecar, { customerIdentityId: "cust-1", consigneeIdentityId: "cons-1", customerName: "Acme", consigneeName: "North" });
    assert.doesNotMatch(commands[0].text, /Acme|North/i);
    assert.deepEqual(commands[0].context.draftLines, []);
    assert.deepEqual(commands[0].context.selectedRows, []);
    assert.equal(Object.hasOwn(commands[0].context, "mode"), false);
    assert.equal(JSON.stringify(commands[0].context).includes("Acme"), false);
    input.value = "add 5 three deep pee Limelight for Acme North"; submit.click(); await flush();
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[1].context.draftLines, [{ itemcode: "SKU-1", commonname: "Limelight", contsize: "3DP", locationcode: "U2", quantity: 10 }]);
    assert.deepEqual(Object.keys(commands[1].context.draftLines[0]).sort(), ["itemcode", "commonname", "contsize", "locationcode", "quantity"].sort());
    assert.doesNotMatch(commands[1].text, /Acme|North/i);
  } finally { widget.destroy(); await browser.restore(); }
});

test("AURA rebinds the selected party before a cached signed reference expires", async () => {
  const browser = fakeRecognitionEnvironment();
  const originalNow = Date.now;
  const binds = [];
  const commands = [];
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async name => ({ items: [{ key: "party", customerName: name, label: name, customerIdentityId: "c1", consigneeIdentityId: "d1" }] }),
    bindParty: async () => { binds.push(true); return { partyRef: `${Date.now() + 60_000}.ref-${binds.length}` }; },
    requestLlm: async body => { commands.push(body); return { ok: true, requestId: body.turnId, reply: "Ready.", actions: [] }; },
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    const submit = document.querySelector('.aura-inputbar button[type="submit"]');
    input.value = "start a request for Megan"; submit.click(); await flush();
    input.value = "add 10 three deep pee Limelight"; submit.click(); await flush();
    assert.equal(binds.length, 1);
    Date.now = () => originalNow() + 50_000;
    input.value = "add 5 three deep pee Limelight"; submit.click(); await flush();
    assert.equal(binds.length, 2);
    assert.equal(commands.length, 2);
    assert.match(commands[1].partyRef, /\.ref-2$/);
  } finally { Date.now = originalNow; widget.destroy(); await browser.restore(); }
});

test("AURA keeps paraphrased customer account questions in the local customer picker", async () => {
  const browser = fakeRecognitionEnvironment();
  let resolverCalls = 0;
  const routed = [];
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    resolveOrderParty: async name => {
      resolverCalls += 1;
      assert.equal(name, "Acme North");
      return { items: [{ key: "acme-key", customerName: "Acme", consigneeName: "North", label: "Acme North" }], hasMore: false };
    },
    requestLlm: async body => { routed.push(body); return { ok: true, requestId: body.turnId, reply: "No tool selected.", actions: [] }; },
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    const submit = document.querySelector('.aura-inputbar button[type="submit"]');
    input.value = "What is the account balance for Acme North?"; submit.click(); await flush();
    assert.equal(resolverCalls, 1);
    assert.equal(routed.length, 0);
    assert.equal(document.querySelectorAll(".aura-choice").length, 1);
    assert.match(document.querySelector(".aura-message").textContent, /choose the exact customer locally/i);
    input.value = "Can you tell me what Acme North owes?"; submit.click(); await flush();
    assert.equal(routed.length, 0, "paraphrased customer details must never reach the provider");
    assert.match(document.querySelector(".aura-message").textContent, /stay local/i);
  } finally { widget.destroy(); await browser.restore(); }
});

test("AURA exposes explicit legacy and retry controls for router configuration failures", async () => {
  const browser = fakeRecognitionEnvironment();
  const widget = mountAuraWidget({
    isAuthorized: () => true,
    requestLlm: async () => { throw Object.assign(new Error("Gemini is not configured."), { status: 503 }); },
    requestV2: async () => ({ ok: true, rows: [], complete: true }),
  });
  try {
    document.querySelector(".aura-fab").click();
    const input = document.querySelector(".aura-inputbar input");
    input.value = "How many Limelight three deep pee do we have?";
    document.querySelector('.aura-inputbar button[type="submit"]').click();
    await flush();
    assert.equal(input.value, "How many Limelight three deep pee do we have?");
    assert.ok([...document.querySelectorAll(".aura-retry")].some(button => button.textContent === "Retry AURA"));
    assert.ok([...document.querySelectorAll(".aura-retry")].some(button => button.textContent === "Use standard lookup"));
    assert.match(document.querySelector(".aura-message").textContent, /not configured/i);
  } finally { widget.destroy(); await browser.restore(); }
});
