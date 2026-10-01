const RECOGNITION_LANGUAGES = ["en-US"];
const LOCAL_VOICE_PREFERENCE = /neural|google us english|samantha|ava|allison|karen|siri/i;
const RESTART_DELAYS_MS = [700, 1400, 2800, 5600, 10000];

function recognitionConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * AURA's recognition session is inert until start() or startIfAllowed().
 * Recognition is always local-only and is suspended whenever the document is hidden.
 */
export function createAuraVoiceSession({
  onState = () => {},
  onTranscript = () => {},
  onRecognition = () => {},
  minimumConfidence = 0.55,
} = {}) {
  let recognition = null;
  let listening = false;
  let destroyed = false;
  let generation = 0;
  let desiredListening = false;
  let speaking = false;
  let restartTimer = null;
  let restartFailures = 0;
  let visibilityListening = false;
  let lastFinalTranscriptAt = 0;

  function emitState(status, message = "") {
    if (!destroyed) onState({ status, message });
  }

  function clearRestart() {
    if (restartTimer != null) clearTimeout(restartTimer);
    restartTimer = null;
  }

  function detachVisibility() {
    if (!visibilityListening || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    visibilityListening = false;
  }

  function attachVisibility() {
    if (visibilityListening || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", onVisibilityChange);
    visibilityListening = true;
  }

  function clearRecognition({ abort = true } = {}) {
    const active = recognition;
    recognition = null;
    if (!active) return;
    active.onstart = null;
    active.onresult = null;
    active.onerror = null;
    active.onend = null;
    if (abort) {
      try { active.abort(); } catch { /* The browser may have ended the recognizer already. */ }
    }
  }

  function stopRecognition() {
    clearRestart();
    listening = false;
    clearRecognition();
  }

  async function localCapability(Constructor) {
    if (!Constructor || typeof Constructor.available !== "function") {
      return { ok: false, message: "On-device voice recognition is unavailable here. Type a command instead." };
    }
    try {
      const result = await Constructor.available({ langs: RECOGNITION_LANGUAGES, processLocally: true });
      return result === "available"
        ? { ok: true }
        : { ok: false, message: "This browser has no on-device English speech pack ready. Voice input stayed off; type a command instead." };
    } catch {
      return { ok: false, message: "AURA could not verify local speech processing. Voice input stayed off; type a command instead." };
    }
  }

  async function microphoneAlreadyGranted() {
    try {
      if (!navigator?.permissions?.query) return false;
      const permission = await navigator.permissions.query({ name: "microphone" });
      return permission.state === "granted";
    } catch {
      return false;
    }
  }

  async function startIfAllowed() {
    if (destroyed) return false;
    if (!(await microphoneAlreadyGranted())) {
      emitState("idle", "Tap the microphone to enable on-device voice input, or type a command.");
      return false;
    }
    return beginListening({ allowPermissionPrompt: false });
  }

  async function start() {
    if (destroyed) return false;
    return beginListening({ allowPermissionPrompt: true });
  }

  async function beginListening({ allowPermissionPrompt }) {
    if (destroyed) return false;
    if (desiredListening && (listening || restartTimer != null || recognition)) return true;
    if (!isVisible()) {
      desiredListening = true;
      attachVisibility();
      emitState("paused", "AURA listens only while the app is visible.");
      return false;
    }
    const Constructor = recognitionConstructor();
    const capability = await localCapability(Constructor);
    if (destroyed) return false;
    if (!capability.ok) {
      desiredListening = false;
      detachVisibility();
      emitState("unavailable", capability.message);
      return false;
    }
    if (!allowPermissionPrompt && !(await microphoneAlreadyGranted())) {
      desiredListening = false;
      detachVisibility();
      emitState("idle", "Tap the microphone to enable on-device voice input.");
      return false;
    }
    if (destroyed) return false;

    desiredListening = true;
    attachVisibility();
    clearRestart();
    const sessionGeneration = ++generation;
    try {
      const engine = new Constructor();
      if (!("processLocally" in engine)) {
        desiredListening = false;
        detachVisibility();
        emitState("unavailable", "This browser cannot guarantee on-device recognition. Voice input stayed off; type a command instead.");
        return false;
      }
      engine.processLocally = true;
      if (engine.processLocally !== true) {
        desiredListening = false;
        detachVisibility();
        emitState("unavailable", "This browser refused on-device recognition. Voice input stayed off; type a command instead.");
        return false;
      }
      engine.lang = RECOGNITION_LANGUAGES[0];
      engine.continuous = true;
      engine.interimResults = true;
      engine.maxAlternatives = 1;
      recognition = engine;
      engine.onstart = () => {
        if (destroyed || sessionGeneration !== generation || recognition !== engine) return;
        if (engine.processLocally !== true) {
          stop();
          emitState("unavailable", "Local-only recognition could not be guaranteed. Voice input stopped; type a command instead.");
          return;
        }
        listening = true;
        emitState("listening");
      };
      engine.onresult = (event) => {
        if (destroyed || sessionGeneration !== generation || recognition !== engine) return;
        if (engine.processLocally !== true) {
          stop();
          emitState("unavailable", "Local-only recognition could not be guaranteed. Voice input stopped; type a command instead.");
          return;
        }
        restartFailures = 0;
        const results = Array.from(event.results || []).map((result) => {
          const alternative = result?.[0];
          return {
            transcript: String(alternative?.transcript ?? "").trim(),
            isFinal: result?.isFinal === true,
            confidence: Number.isFinite(alternative?.confidence) ? alternative.confidence : 1,
          };
        });
        const text = results.map((result) => result.transcript).filter(Boolean).join(" ").trim();
        if (!text) return;
        const resultIndex = Number.isInteger(event.resultIndex) ? event.resultIndex : Math.max(0, results.length - 1);
        const changed = results.slice(resultIndex);
        const changedText = changed.map((result) => result.transcript).filter(Boolean).join(" ").trim();
        const finalConfidence = changed.filter((result) => result.isFinal).reduce((value, result) => Math.min(value, result.confidence), 1);
        if (finalConfidence < minimumConfidence) {
          emitState("hearing", "I didn’t get a clean read. Keep going or type a command.");
          return;
        }
        emitState("hearing", text);
        onRecognition({ results, text, resultIndex, processLocally: engine.processLocally === true });
        const hasNewFinal = changed.some((result) => result.isFinal);
        if (hasNewFinal && changedText) {
          const now = Date.now();
          if (now - lastFinalTranscriptAt >= 250) {
            lastFinalTranscriptAt = now;
            onTranscript(changedText, { confidence: finalConfidence, isFinal: true, processLocally: true });
          }
        }
      };
      engine.onerror = (event) => {
        if (destroyed || sessionGeneration !== generation || recognition !== engine) return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          desiredListening = false;
          stopRecognition();
          detachVisibility();
          emitState("error", event.error === "not-allowed"
            ? "Microphone access is blocked. Tap to allow it or type a command."
            : "The local speech service is unavailable. Voice input stayed off.");
          return;
        }
        if (event.error === "language-not-supported") {
          desiredListening = false;
          stopRecognition();
          detachVisibility();
          emitState("unavailable", "On-device English recognition is unavailable. Type a command instead.");
          return;
        }
        if (event.error === "audio-capture") {
          desiredListening = false;
          stopRecognition();
          detachVisibility();
          emitState("error", "No microphone was available. Type a command instead.");
          return;
        }
        emitState("hearing", "Voice recognition paused. AURA will make a limited local restart.");
      };
      engine.onend = () => {
        if (destroyed || sessionGeneration !== generation || recognition !== engine) return;
        recognition = null;
        listening = false;
        engine.onstart = null;
        engine.onresult = null;
        engine.onerror = null;
        engine.onend = null;
        if (!desiredListening) {
          emitState("idle");
          return;
        }
        if (!isVisible()) {
          emitState("paused", "AURA listens only while the app is visible.");
          return;
        }
        if (speaking) return;
        if (restartFailures >= RESTART_DELAYS_MS.length) {
          desiredListening = false;
          detachVisibility();
          emitState("error", "On-device listening stopped after repeated browser interruptions. Tap the microphone to restart.");
          return;
        }
        const delay = RESTART_DELAYS_MS[restartFailures];
        restartFailures += 1;
        emitState("restarting", "Reconnecting to on-device speech…");
        restartTimer = setTimeout(() => {
          restartTimer = null;
          if (destroyed || !desiredListening || !isVisible() || speaking) return;
          void beginListening({ allowPermissionPrompt: false });
        }, delay);
      };
      emitState("starting");
      engine.start();
      return true;
    } catch (error) {
      clearRecognition();
      listening = false;
      if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
        desiredListening = false;
        detachVisibility();
      }
      emitState("error", error?.name === "NotAllowedError"
        ? "Microphone access is blocked. Tap to allow it or type a command."
        : "AURA could not start local voice input. Type a command instead.");
      return false;
    }
  }

  function onVisibilityChange() {
    if (destroyed || !desiredListening) return;
    if (!isVisible()) {
      stopRecognition();
      emitState("paused", "AURA listens only while the app is visible.");
      return;
    }
    if (!speaking) {
      restartFailures = 0;
      void beginListening({ allowPermissionPrompt: false });
    }
  }

  function stop() {
    if (destroyed) return;
    desiredListening = false;
    generation += 1;
    restartFailures = 0;
    stopRecognition();
    detachVisibility();
    emitState("idle");
  }

  function speak(text) {
    if (destroyed || typeof window === "undefined" || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") return false;
    const synthesis = window.speechSynthesis;
    const voices = synthesis.getVoices().filter((voice) => voice.localService === true && /^en(?:-|_)/i.test(voice.lang || ""));
    const voice = voices.find((candidate) => LOCAL_VOICE_PREFERENCE.test(candidate.name)) || voices[0];
    if (!voice) return false;

    speaking = true;
    clearRestart();
    stopRecognition();
    const utterance = new window.SpeechSynthesisUtterance(String(text ?? ""));
    utterance.voice = voice;
    utterance.rate = 1.08;
    utterance.pitch = 0.92;
    utterance.volume = 1;
    const resume = () => {
      if (!speaking) return;
      speaking = false;
      if (destroyed || !desiredListening) return;
      if (!isVisible()) {
        emitState("paused", "AURA listens only while the app is visible.");
        return;
      }
      restartFailures = 0;
      void beginListening({ allowPermissionPrompt: false });
    };
    utterance.onend = resume;
    utterance.onerror = resume;
    try {
      synthesis.cancel();
      synthesis.speak(utterance);
      emitState("speaking");
      return true;
    } catch {
      resume();
      return false;
    }
  }

  function destroy() {
    if (destroyed) return;
    desiredListening = false;
    destroyed = true;
    generation += 1;
    speaking = false;
    clearRestart();
    detachVisibility();
    listening = false;
    clearRecognition();
    try { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); } catch { /* Optional browser feature. */ }
  }

  return {
    start,
    startIfAllowed,
    stop,
    speak,
    destroy,
    get listening() { return listening; },
    get enabled() { return desiredListening; },
  };
}
