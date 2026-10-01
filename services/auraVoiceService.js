const RECOGNITION_LANGUAGES = ["en-US"];
const LOCAL_VOICE_PREFERENCE = /neural|google us english|samantha|ava|allison|karen|siri/i;

function recognitionConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Create an inert voice session. No recognition engine or microphone is touched until start(). */
export function createAuraVoiceSession({ onState = () => {}, onTranscript = () => {}, minimumConfidence = 0.55 } = {}) {
  let recognition = null;
  let listening = false;
  let destroyed = false;
  let generation = 0;
  let lastFinalTranscriptAt = 0;

  function state(status, message = "") {
    if (!destroyed) onState({ status, message });
  }

  function clearRecognition() {
    const active = recognition;
    recognition = null;
    if (!active) return;
    active.onstart = null;
    active.onresult = null;
    active.onerror = null;
    active.onend = null;
    try { active.abort(); } catch { /* Browser may already have ended the session. */ }
  }

  async function checkLocalRecognition(Constructor) {
    if (!Constructor || typeof Constructor.available !== "function") {
      return { ok: false, message: "On-device voice recognition is unavailable here. Type a command instead." };
    }
    try {
      const availability = await Constructor.available({ langs: RECOGNITION_LANGUAGES, processLocally: true });
      if (availability !== "available") {
        return { ok: false, message: "This browser has no on-device English speech pack ready. Voice input stayed off; type a command instead." };
      }
      return { ok: true };
    } catch {
      return { ok: false, message: "AURA could not verify local speech processing. Voice input stayed off; type a command instead." };
    }
  }

  async function start() {
    if (destroyed) return false;
    if (listening) { stop(); return false; }
    const Constructor = recognitionConstructor();
    const capability = await checkLocalRecognition(Constructor);
    if (destroyed) return false;
    if (!capability.ok) {
      state("unavailable", capability.message);
      return false;
    }

    const myGeneration = ++generation;
    try {
      const engine = new Constructor();
      // Fail closed. processLocally is required; never allow browser-selected cloud recognition.
      if (!("processLocally" in engine)) {
        state("unavailable", "This browser cannot guarantee on-device recognition. Voice input stayed off; type a command instead.");
        return false;
      }
      engine.processLocally = true;
      if (engine.processLocally !== true) {
        state("unavailable", "This browser refused on-device recognition. Voice input stayed off; type a command instead.");
        return false;
      }
      engine.lang = RECOGNITION_LANGUAGES[0];
      engine.continuous = false;
      engine.interimResults = true;
      engine.maxAlternatives = 1;
      recognition = engine;
      engine.onstart = () => {
        if (destroyed || myGeneration !== generation) return;
        if (engine.processLocally !== true) {
          stop();
          state("unavailable", "Local-only recognition could not be guaranteed. Voice input stopped; type a command instead.");
          return;
        }
        listening = true;
        state("listening");
      };
      engine.onresult = (event) => {
        if (destroyed || myGeneration !== generation) return;
        if (engine.processLocally !== true) {
          stop();
          state("unavailable", "Local-only recognition could not be guaranteed. Voice input stopped; type a command instead.");
          return;
        }
        const result = event.results?.[event.resultIndex];
        const alternative = result?.[0];
        const transcript = String(alternative?.transcript ?? "").trim();
        if (!transcript) return;
        if (!result.isFinal) {
          state("hearing", transcript);
          return;
        }
        const confidence = Number.isFinite(alternative.confidence) ? alternative.confidence : 1;
        if (confidence < minimumConfidence) {
          state("listening", "I didn’t get a clean read. Try again or type it.");
          return;
        }
        const now = Date.now();
        if (now - lastFinalTranscriptAt < 250) return;
        lastFinalTranscriptAt = now;
        onTranscript(transcript, { confidence, isFinal: true, processLocally: engine.processLocally === true });
      };
      engine.onerror = (event) => {
        if (destroyed || myGeneration !== generation) return;
        const messages = {
          "not-allowed": "Microphone access is blocked. You can type a command instead.",
          "service-not-allowed": "The local speech service is unavailable. Voice input stayed off.",
          "language-not-supported": "On-device English recognition is unavailable. Type a command instead.",
          "audio-capture": "No microphone was available. Type a command instead.",
        };
        state("error", messages[event.error] || "Voice input ended. You can type a command instead.");
      };
      engine.onend = () => {
        if (destroyed || myGeneration !== generation) return;
        listening = false;
        engine.onstart = null;
        engine.onresult = null;
        engine.onerror = null;
        engine.onend = null;
        if (recognition === engine) recognition = null;
        state("idle");
      };
      state("starting");
      engine.start();
      return true;
    } catch (error) {
      clearRecognition();
      listening = false;
      state("error", error?.name === "NotAllowedError" ? "Microphone access is blocked. Type a command instead." : "AURA could not start local voice input. Type a command instead.");
      return false;
    }
  }

  function stop() {
    if (destroyed) return;
    generation += 1;
    listening = false;
    clearRecognition();
    state("idle");
  }

  function speak(text) {
    if (destroyed || typeof window === "undefined" || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") return false;
    const synthesis = window.speechSynthesis;
    const utterance = new window.SpeechSynthesisUtterance(String(text ?? ""));
    const voices = synthesis.getVoices().filter((voice) => voice.localService === true && /^en(?:-|_)/i.test(voice.lang || ""));
    const voice = voices.find((candidate) => LOCAL_VOICE_PREFERENCE.test(candidate.name)) || voices[0];
    // Do not speak through an unknown or remote voice. The visible response remains available in the UI.
    if (!voice) return false;
    utterance.voice = voice;
    utterance.rate = 1.08;
    utterance.pitch = 0.92;
    utterance.volume = 1;
    try {
      synthesis.cancel();
      synthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    generation += 1;
    listening = false;
    clearRecognition();
    try { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); } catch { /* Optional browser feature. */ }
  }

  return { start, stop, speak, destroy, get listening() { return listening; } };
}
