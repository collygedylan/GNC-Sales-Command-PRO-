import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createAuraVoiceSession } from "../services/auraVoiceService.js";
import { parseAuraIntent } from "../utils/auraIntentParser.js";
import { mountAuraWidget } from "../components/common/auraVoiceWidget.js";

function fakeRecognitionEnvironment({ permission = "granted", available = "available" } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://field.example.test/" });
  Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value: "visible" });
  const previous = new Map();
  for (const name of ["window", "document", "navigator"]) previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  const engines = [];
  class FakeRecognition {
    static async available() { return available; }
    constructor() {
      this.aborted = false;
      this.processLocally = false;
      engines.push(this);
    }
    start() { this.started = true; this.onstart?.(); }
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

test("AURA starts only with existing permission and forces continuous local recognition", async () => {
  const browser = fakeRecognitionEnvironment();
  try {
    const session = createAuraVoiceSession();
    assert.equal(await session.startIfAllowed(), true);
    assert.equal(browser.engines.length, 1);
    assert.equal(browser.engines[0].continuous, true);
    assert.equal(browser.engines[0].interimResults, true);
    assert.equal(browser.engines[0].processLocally, true);
    session.destroy();
  } finally { await browser.restore(); }
});

test("permission denial and missing local recognition fail closed without a recognizer", async () => {
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
    const session = createAuraVoiceSession();
    assert.equal(await session.startIfAllowed(), false);
    assert.equal(unavailable.engines.length, 0);
    session.destroy();
  } finally { await unavailable.restore(); }
});

test("AURA pauses while hidden and resumes only while visible", async () => {
  const browser = fakeRecognitionEnvironment();
  try {
    const session = createAuraVoiceSession();
    await session.startIfAllowed();
    const first = browser.engines[0];
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(first.aborted, true);
    assert.equal(session.enabled, true);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    await flush();
    assert.equal(browser.engines.length, 2);
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
    assert.match(states.at(-1).message, /repeated browser interruptions/i);
    assert.deepEqual(scheduled.map((timer) => timer.delay), [700, 1400, 2800, 5600, 10000]);
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
    engine.onresult({ results: [speechResult("Hey Aura", false)], resultIndex: 0 });
    engine.onresult({ results: [speechResult("Hey Aura", true)], resultIndex: 0 });
    engine.onresult({ results: [
      speechResult("Hey Aura", true),
      speechResult("send a message to Megan Kelly saying The order is staged", false),
    ], resultIndex: 1 });
    assert.equal(sent.length, 0);
    const finalResults = [
      speechResult("Hey Aura", true),
      speechResult("send a message to Megan Kelly saying The order is staged", true),
    ];
    engine.onresult({ results: finalResults, resultIndex: 1 });
    await flush();
    engine.onresult({ results: finalResults, resultIndex: 1 });
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
