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

function mount() {
  return mountAuraWidget({ isAuthorized: () => true });
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

    engine.onresult(result("Hey Aura, florp"));
    await flush();
    assert.equal(badge.textContent, "On-device speech");
    assert.match(panel.querySelector(".aura-status").textContent, /Hey Aura, florp/i);
    assert.match(panel.querySelector(".aura-message").textContent, /didn’t quite catch/i);

    engine.onerror({ error: "audio-capture" });
    assert.equal(badge.textContent, "On-device speech");
    assert.match(panel.querySelector(".aura-status").textContent, /microphone|type a command/i);
    assert.equal(mic.getAttribute("aria-label"), "Start voice input");
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
    assert.equal(badge.textContent, "Browser speech — may use network");
    assert.match(panel.querySelector(".aura-status").textContent, /browser/i);
    assert.doesNotMatch(panel.querySelector(".aura-status").textContent, /on-device|locally/i);
    assert.equal(mic.getAttribute("aria-label"), "Pause voice input");

    env.engines[0].onresult(result("Hey Aura, cloud locally remote"));
    await flush();
    assert.equal(badge.textContent, "Browser speech — may use network");
    assert.match(panel.querySelector(".aura-status").textContent, /cloud locally remote/i);
    assert.doesNotMatch(panel.querySelector(".aura-status").textContent, /in the browser network/i);
    env.engines[0].onerror({ error: "audio-capture" });
    assert.equal(badge.textContent, "Browser speech — may use network");
    assert.doesNotMatch(panel.querySelector(".aura-status").textContent, /on-device|locally/i);
    assert.equal(mic.getAttribute("aria-label"), "Start voice input");
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
  const widget = mount();
  try {
    const panel = openPanel();
    panel.querySelector(".aura-mic").click();
    await flush();
    assert.equal(panel.querySelector(".aura-mode").textContent, "On-device speech");

    const input = panel.querySelector("input");
    input.value = "an unrecognized command";
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
