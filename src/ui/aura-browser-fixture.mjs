// Test fixture for the authenticated footer-owned AURA control.
import { JSDOM } from 'jsdom';

export function createAuraBrowserFixture({
  permission = "granted",
  includeRecognition = true,
  available = "available",
  supportsProcessLocally = true,
} = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><nav id="bottom-nav"><button id="footer-aura-btn" class="aura-fab">AURA</button></nav></body></html>`, { url: "https://field.example.test/" });
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
  if (includeRecognition) Object.defineProperty(dom.window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
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

