const RECOGNITION_LANGUAGES = ["en-US"];
const LOCAL_VOICE_PREFERENCE = /neural|google us english|samantha|ava|allison|karen|siri/i;
const RESTART_DELAYS_MS = [700, 1400, 2800, 5600, 10000];
const LOCAL_CAPABILITY_TIMEOUT_MS = 2000;

function splitSpeechIntoChunks(text, limit = 220) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks = [];
  let rest = normalized;
  while (rest.length > limit) {
    const punctuation = Math.max(rest.lastIndexOf(". ", limit - 1), rest.lastIndexOf("? ", limit - 1), rest.lastIndexOf("! ", limit - 1), rest.lastIndexOf("; ", limit - 1));
    let end, next;
    if (punctuation >= Math.floor(limit * 0.55)) {
      end = punctuation + 1;
      next = punctuation + 2;
    } else {
      const space = rest.lastIndexOf(" ", limit);
      end = space > 0 ? space : limit;
      next = space > 0 ? space + 1 : limit;
    }
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(next).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function recognitionConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * AURA recognition is inert until start() or startIfAllowed(). It prefers a
 * verified on-device recognizer. Browser-provided recognition is available
 * only after an explicit microphone start and runs for one utterance.
 */
export function createAuraVoiceSession({
  onState = () => {},
  onTranscript = () => {},
  onRecognition = () => {},
  minimumConfidence = 0.55,
  localCapabilityTimeoutMs = LOCAL_CAPABILITY_TIMEOUT_MS,
} = {}) {
  const capabilityTimeout = Number.isFinite(localCapabilityTimeoutMs)
    ? Math.min(LOCAL_CAPABILITY_TIMEOUT_MS, Math.max(0, localCapabilityTimeoutMs))
    : LOCAL_CAPABILITY_TIMEOUT_MS;
  let recognition = null;
  let listening = false;
  let destroyed = false;
  let generation = 0;
  // Permission and local-pack checks are async. This token prevents a late
  // completion from resurrecting recognition after Stop, hide, or teardown.
  let startAttempt = 0;
  let desiredListening = false;
  let speaking = false;
  let speechGeneration = 0;
  let busy = false;
  let restartTimer = null;
  let restartFailures = 0;
  let visibilityListening = false;
  let lastFinalTranscriptAt = 0;
  let activeRecognitionMode = null;
  let browserFinalizationTimer = null;
  let handsFree = false;
  let tapToTalkMode = false;
  let preparedLocalCapability = null;
  let localCapabilityPromise = null;
  let handsFreePermissionGranted = false;

  function emitState(status, message = "") {
    if (!destroyed) onState({ status, message, recognitionMode: activeRecognitionMode });
  }

  function clearRestart() {
    if (restartTimer != null) clearTimeout(restartTimer);
    restartTimer = null;
  }

  function clearBrowserFinalization() {
    if (browserFinalizationTimer != null) clearTimeout(browserFinalizationTimer);
    browserFinalizationTimer = null;
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
    active.onspeechend = null;
    if (abort) {
      try { active.abort(); } catch { /* The browser may have ended the recognizer already. */ }
    }
  }

  function stopRecognition() {
    clearRestart();
    clearBrowserFinalization();
    listening = false;
    clearRecognition();
  }

  function finishBrowserTurn(status = "idle", message = "", { abort = true } = {}) {
    desiredListening = false;
    startAttempt += 1;
    generation += 1;
    clearRestart();
    clearBrowserFinalization();
    listening = false;
    clearRecognition({ abort });
    detachVisibility();
    emitState(status, message);
  }

  async function localCapability(Constructor) {
    if (!Constructor || typeof Constructor.available !== "function") return false;
    // Headless Chromium exposes this experimental native method, but calling it
    // crashes the renderer. Test doubles remain probeable so voice behavior can
    // still be covered in browser automation.
    if (navigator?.webdriver === true) {
      try {
        if (/\[native code\]/.test(Function.prototype.toString.call(Constructor.available))) return false;
      } catch { return false; }
    }
    let timeoutId = null;
    try {
      const available = Promise.resolve().then(() => Constructor.available({
        langs: RECOGNITION_LANGUAGES,
        processLocally: true,
      }));
      const result = await Promise.race([
        available,
        new Promise(resolve => { timeoutId = setTimeout(() => resolve("timeout"), capabilityTimeout); }),
      ]);
      return result === "available";
    } catch {
      return false;
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
    }
  }

  function prepare() {
    const Constructor = recognitionConstructor();
    if (!localCapabilityPromise) localCapabilityPromise = localCapability(Constructor).then(value => {
      preparedLocalCapability = value;
      return value;
    });
    return localCapabilityPromise;
  }

  async function selectRecognitionMode(Constructor, { allowBrowserFallback }) {
    if (!Constructor) return { mode: null, message: "Browser speech recognition is unavailable here. Type a command instead." };
    const localAvailable = await localCapability(Constructor);
    if (localAvailable) return { mode: "local", message: "On-device English recognition is ready." };
    if (!allowBrowserFallback) {
      return {
        mode: null,
        message: "On-device English recognition is unavailable. Tap the microphone for one browser-recognized command; your browser may process audio online, or type a command.",
      };
    }
    return {
      mode: "browser",
      message: "Using browser speech recognition. Your browser may process microphone audio through its provider.",
    };
  }

  function configureRecognitionMode(engine, mode) {
    if (mode === "local") {
      if (!("processLocally" in engine)) return false;
      try { engine.processLocally = true; } catch { return false; }
      return engine.processLocally === true;
    }
    if (mode !== "browser") return false;
    if ("processLocally" in engine) {
      try { engine.processLocally = false; } catch { return false; }
      return engine.processLocally === false;
    }
    // Older implementations do not expose processLocally and use their
    // browser-provided recognition service when start() is called.
    return true;
  }

  function recognitionModeIsValid(engine, mode) {
    if (mode === "local") return "processLocally" in engine && engine.processLocally === true;
    if (mode === "browser") return !("processLocally" in engine) || engine.processLocally === false;
    return false;
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
    if (busy || speaking) return false;
    if (desiredListening && (listening || restartTimer != null || recognition)) return true;
    activeRecognitionMode = null;
    tapToTalkMode = false;
    restartFailures = 0;
    const attempt = ++startAttempt;
    if (!(await microphoneAlreadyGranted())) {
      if (destroyed || attempt !== startAttempt || !isVisible()) return false;
      emitState("idle", "Tap the microphone to enable voice input, or type a command.");
      return false;
    }
    if (destroyed || attempt !== startAttempt || !isVisible() || speaking || busy) return false;
    return beginListening({ allowPermissionPrompt: false, allowBrowserFallback: false, attempt });
  }

  async function start() {
    if (destroyed) return false;
    if (busy || speaking) return false;
    if (desiredListening && (listening || restartTimer != null || recognition)) return true;
    activeRecognitionMode = null;
    restartFailures = 0;
    const attempt = ++startAttempt;
    handsFree = false;
    tapToTalkMode = false;
    return beginListening({ allowPermissionPrompt: true, allowBrowserFallback: true, attempt });
  }

  async function startTapToTalk() {
    if (destroyed || busy || speaking) return false;
    if (desiredListening && (listening || restartTimer != null || recognition)) return true;
    activeRecognitionMode = null;
    restartFailures = 0;
    handsFree = false;
    tapToTalkMode = true;
    const attempt = ++startAttempt;
    return beginListening({ allowPermissionPrompt: true, allowBrowserFallback: true, attempt, tapToTalkMode: true });
  }

  async function startHandsFree() {
    if (destroyed || busy || speaking) return false;
    if (desiredListening && (listening || restartTimer != null || recognition)) return true;
    handsFree = true;
    tapToTalkMode = false;
    activeRecognitionMode = null;
    restartFailures = 0;
    const attempt = ++startAttempt;
    // Invoke immediately from the trusted activation handler; recognition setup
    // continues without waiting on any unrelated network request.
    const recognitionMode = preparedLocalCapability === true ? "local" : "browser";
    return beginListening({ allowPermissionPrompt: true, allowBrowserFallback: true, attempt, recognitionMode, handsFreeMode: true });
  }

  async function beginListening({ allowPermissionPrompt, allowBrowserFallback = true, attempt, recognitionMode = activeRecognitionMode, handsFreeMode = handsFree, tapToTalkMode: tapMode = tapToTalkMode }) {
    if (destroyed || attempt !== startAttempt || speaking || busy) return false;
    if (desiredListening && (listening || restartTimer != null || recognition)) return true;
    if (!isVisible()) {
      desiredListening = false;
      emitState("paused", "AURA listens only while the app is visible.");
      return false;
    }
    desiredListening = true;
    attachVisibility();
    emitState("starting", recognitionMode === "local"
      ? "Starting on-device English recognition…"
      : recognitionMode === "browser"
        ? "Starting browser speech recognition…"
        : "Checking speech recognition availability…");
    const Constructor = recognitionConstructor();
    let selectedMode = recognitionMode;
    let selectionMessage = "";
    if (!selectedMode) {
      const selection = await selectRecognitionMode(Constructor, { allowBrowserFallback });
      if (destroyed || attempt !== startAttempt || !desiredListening || !isVisible()) return false;
      selectedMode = selection.mode;
      selectionMessage = selection.message;
      activeRecognitionMode = selectedMode;
    }
    if (destroyed || attempt !== startAttempt || !desiredListening || !isVisible() || speaking || busy) return false;
    if (!selectedMode) {
      desiredListening = false;
      detachVisibility();
      emitState("unavailable", selectionMessage || "Speech recognition is unavailable. Type a command instead.");
      return false;
    }
    activeRecognitionMode = selectedMode;
    emitState("starting", selectionMessage || (selectedMode === "local"
      ? "On-device English recognition is ready."
      : "Using browser speech recognition; your browser may process audio online."));
    if (!allowPermissionPrompt && !(handsFreeMode && handsFreePermissionGranted) && !(await microphoneAlreadyGranted())) {
      if (destroyed || attempt !== startAttempt || !desiredListening || !isVisible() || speaking || busy) return false;
      desiredListening = false;
      detachVisibility();
      emitState("idle", "Tap the microphone to enable voice input.");
      return false;
    }
    if (destroyed || attempt !== startAttempt || !desiredListening || !isVisible() || speaking || busy) return false;

    attachVisibility();
    clearRestart();
    const sessionGeneration = ++generation;
    try {
      const engine = new Constructor();
      let configured = configureRecognitionMode(engine, selectedMode);
      if (!configured && selectedMode === "local" && allowBrowserFallback) {
        selectedMode = "browser";
        activeRecognitionMode = selectedMode;
        selectionMessage = "On-device recognition is unavailable. Using browser recognition; your browser may process microphone audio through its provider.";
        emitState("starting", selectionMessage);
        configured = configureRecognitionMode(engine, selectedMode);
      }
      if (!configured) {
        desiredListening = false;
        detachVisibility();
        emitState("unavailable", selectedMode === "local"
          ? "On-device recognition could not be selected. Tap the microphone to retry, or type a command."
          : "Browser recognition could not be selected. Type a command instead.");
        return false;
      }
      activeRecognitionMode = selectedMode;
      engine.lang = RECOGNITION_LANGUAGES[0];
      engine.continuous = !tapMode && (selectedMode === "local" || handsFreeMode);
      engine.interimResults = true;
      engine.maxAlternatives = 1;
      recognition = engine;
      let browserFinalSegments = [];
      let browserInterimSegments = [];
      let browserSpeechEnded = false;
      let browserTurnCompleted = false;
      let tapToTalkFinalReceived = false;

      const completeBrowserTurn = (status = "idle", { abort = false } = {}) => {
        if (browserTurnCompleted || selectedMode !== "browser" || destroyed || sessionGeneration !== generation || recognition !== engine) return;
        browserTurnCompleted = true;
        clearBrowserFinalization();
        const finalText = browserFinalSegments.filter(Boolean).join(" ").trim();
        const interimText = browserInterimSegments.filter(Boolean).join(" ").trim();
        const text = finalText || interimText;
        const completionSource = finalText ? "final" : text ? "interim_end" : null;
        finishBrowserTurn(text ? "idle" : status, text
          ? "One browser-recognized command captured. Tap the microphone to speak again."
          : "No command was captured. Tap the microphone to try again, or type a command.", { abort });
        if (!text) return;
        const confidences = browserResultConfidences
          .filter((value, index) => Boolean(browserFinalSegments[index]) && Number.isFinite(value));
        const confidence = confidences.length ? Math.min(...confidences) : null;
        lastFinalTranscriptAt = Date.now();
        onTranscript(text, {
          confidence,
          isFinal: completionSource === "final",
          completionSource,
          recognitionMode: "browser",
          lowConfidence: confidence != null && confidence < minimumConfidence,
          recognitionId: sessionGeneration,
          epoch: sessionGeneration,
          processLocally: false,
        });
      };
      let browserResultConfidences = [];
      engine.onstart = () => {
        if (destroyed || sessionGeneration !== generation || recognition !== engine) return;
        if (!recognitionModeIsValid(engine, selectedMode)) {
          stop();
          emitState("unavailable", "The selected recognition mode changed unexpectedly. Voice input stopped; tap the microphone to retry or type a command.");
          return;
        }
        listening = true;
        if (handsFreeMode) handsFreePermissionGranted = true;
        emitState("listening", selectedMode === "local"
          ? "Listening on this device."
          : "Browser recognition is active; your browser may process audio online.");
      };
      engine.onresult = (event) => {
        if (destroyed || sessionGeneration !== generation || recognition !== engine) return;
        if (!recognitionModeIsValid(engine, selectedMode)) {
          stop();
          emitState("unavailable", "The selected recognition mode changed unexpectedly. Voice input stopped; tap the microphone to retry or type a command.");
          return;
        }
        const results = Array.from(event.results || []).map((result, index) => {
          // Explicitly read the first alternative, including index zero. Some
          // native SpeechRecognitionResult objects are only array-like.
          const alternative = result?.[0];
          return {
            index,
            transcript: String(alternative?.transcript ?? "").trim(),
            isFinal: result?.isFinal === true,
            confidence: Number.isFinite(alternative?.confidence) ? alternative.confidence : null,
          };
        });
        const text = results.map((result) => result.transcript).filter(Boolean).join(" ").trim();
        const resultIndex = Number.isInteger(event.resultIndex) ? event.resultIndex : Math.max(0, results.length - 1);
        const changed = results.slice(resultIndex);
        const changedText = changed.map((result) => result.transcript).filter(Boolean).join(" ").trim();
        if (!results.length) return;
        const finiteConfidence = changed.map(result => result.confidence).filter(Number.isFinite);
        const finalConfidence = selectedMode === "local"
          ? changed.filter(result => result.isFinal)
            .reduce((value, result) => Math.min(value, Number.isFinite(result.confidence) ? result.confidence : 1), 1)
          : finiteConfidence.length ? Math.min(...finiteConfidence) : null;
        if (selectedMode === "local" && finalConfidence < minimumConfidence) {
          emitState("hearing", "I didn’t get a clean read. Keep going or type a command.");
          return;
        }
        // A usable result is a healthy session signal. The bounded restart
        // budget applies to consecutive failures, not an otherwise working mic.
        restartFailures = 0;
        emitState("hearing", text);
        const processLocally = selectedMode === "local" && engine.processLocally === true;
        if (selectedMode === "browser") {
          // Interim entries may be removed or shortened when a browser
          // revises its result list. Rebuild that snapshot on every event,
          // while keeping finalized segments stable across events.
          browserInterimSegments = [];
          for (const result of results) {
            if (result.isFinal) {
              browserFinalSegments[result.index] = result.transcript;
              browserResultConfidences[result.index] = result.confidence;
              delete browserInterimSegments[result.index];
            } else if (!browserFinalSegments[result.index]) {
              browserInterimSegments[result.index] = result.transcript;
            }
          }
          const assembledFinal = browserFinalSegments.filter(Boolean).join(" ").trim();
          const assembledInterim = browserInterimSegments.filter(Boolean).join(" ").trim();
          const previewText = [assembledFinal, assembledInterim].filter(Boolean).join(" ").trim();
          onRecognition({
            results,
            text: previewText,
            previewText,
            resultIndex,
            epoch: sessionGeneration,
            recognitionId: sessionGeneration,
            recognitionMode: "browser",
            handsFree: handsFreeMode,
            tapToTalk: tapMode,
            processLocally: false,
            phase: "preview",
            handsFree: handsFreeMode,
            confidence: finalConfidence,
            lowConfidence: finalConfidence != null && finalConfidence < minimumConfidence,
          });
          return;
          // Hands-free browser recognition stays open across utterances.
          // Its end/error paths share the bounded restart policy below.
        }
        onRecognition({ results, text, resultIndex, epoch: sessionGeneration, recognitionId: sessionGeneration, recognitionMode: selectedMode, processLocally, handsFree: handsFreeMode, tapToTalk: tapMode });
        const hasNewFinal = changed.some((result) => result.isFinal);
        if (tapMode && hasNewFinal) tapToTalkFinalReceived = true;
        if (hasNewFinal && changedText) {
          const now = Date.now();
          if (now - lastFinalTranscriptAt >= 250) {
            lastFinalTranscriptAt = now;
            onTranscript(changedText, { confidence: finalConfidence, isFinal: true, recognitionMode: selectedMode, processLocally, handsFree: handsFreeMode });
          }
        }
      };
      engine.onerror = (event) => {
        if (destroyed || sessionGeneration !== generation || recognition !== engine) return;
        if (selectedMode === "browser" && !handsFreeMode) {
          const detail = event.error === "no-speech"
            ? "No speech was captured. Tap the microphone to try again, or type a command."
            : event.error === "network"
              ? "Browser speech recognition had a network problem. Tap the microphone to retry, or type a command."
              : event.error === "not-allowed" || event.error === "service-not-allowed"
                ? "Microphone or browser speech access is blocked. Tap to allow it or type a command."
                : "Browser speech recognition ended. Tap the microphone to try again, or type a command.";
          finishBrowserTurn(event.error === "no-speech" ? "idle" : "error", detail);
          return;
        }
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          desiredListening = false;
          stopRecognition();
          detachVisibility();
          emitState("error", event.error === "not-allowed"
            ? "Microphone access is blocked. Tap to allow it or type a command."
            : selectedMode === "local"
              ? "The on-device speech service is unavailable. Tap the microphone to retry, or type a command."
              : "The browser speech service is unavailable. Voice input stayed off; type a command instead.");
          return;
        }
        if (event.error === "language-not-supported") {
          desiredListening = false;
          stopRecognition();
          detachVisibility();
          emitState("unavailable", selectedMode === "local"
            ? "On-device English recognition is unavailable. Tap the microphone to retry, or type a command."
            : "English recognition is unavailable in this browser. Type a command instead.");
          return;
        }
        if (event.error === "audio-capture") {
          desiredListening = false;
          stopRecognition();
          detachVisibility();
          emitState("error", "No microphone was available. Type a command instead.");
          return;
        }
        emitState("hearing", "Voice recognition paused. AURA will make a limited restart.");
      };
      engine.onspeechend = () => {
        if (selectedMode !== "browser" || handsFreeMode || destroyed || sessionGeneration !== generation || recognition !== engine || browserSpeechEnded) return;
        browserSpeechEnded = true;
        clearBrowserFinalization();
        browserFinalizationTimer = setTimeout(() => {
          browserFinalizationTimer = null;
          completeBrowserTurn("idle", { abort: true });
        }, 1000);
        try { engine.stop(); } catch { /* onend or the finalization deadline closes the turn. */ }
      };
      engine.onend = () => {
        if (destroyed || sessionGeneration !== generation || recognition !== engine) return;
        if (selectedMode === "browser" && !handsFreeMode) {
          completeBrowserTurn("idle");
          return;
        }
        if (tapMode) {
          desiredListening = false;
          recognition = null;
          listening = false;
          engine.onstart = null;
          engine.onresult = null;
          engine.onerror = null;
          engine.onend = null;
          engine.onspeechend = null;
          detachVisibility();
          emitState("idle", tapToTalkFinalReceived
            ? "One command captured. Tap the microphone to speak again."
            : "No command was captured. Tap the microphone to try again, or type a command.");
          return;
        }
        recognition = null;
        listening = false;
        engine.onstart = null;
        engine.onresult = null;
        engine.onerror = null;
        engine.onend = null;
        engine.onspeechend = null;
        if (!desiredListening) {
          emitState("idle");
          return;
        }
        if (!isVisible()) {
          emitState("paused", "AURA listens only while the app is visible.");
          return;
        }
        if (speaking || busy) return;
        if (restartFailures >= RESTART_DELAYS_MS.length) {
          desiredListening = false;
          detachVisibility();
          emitState("error", "Voice input stopped after repeated interruptions. Tap the microphone to restart.");
          return;
        }
        const delay = RESTART_DELAYS_MS[restartFailures];
        restartFailures += 1;
        emitState("restarting", selectedMode === "local" ? "Reconnecting to on-device speech…" : "Reconnecting to browser speech…");
        restartTimer = setTimeout(() => {
          restartTimer = null;
          if (destroyed || !desiredListening || !isVisible() || speaking || busy) return;
          const attempt = ++startAttempt;
          void beginListening({ allowPermissionPrompt: false, allowBrowserFallback: handsFree, recognitionMode: selectedMode, attempt, handsFreeMode: handsFree, tapToTalkMode });
        }, delay);
      };
      emitState("starting");
      engine.start();
      return true;
    } catch (error) {
      clearRecognition();
      listening = false;
      desiredListening = false;
      activeRecognitionMode = null;
      detachVisibility();
      emitState("error", error?.name === "NotAllowedError"
        ? "Microphone access is blocked. Tap to allow it or type a command."
        : selectedMode === "local"
          ? "AURA could not start on-device voice input. Tap the microphone to retry, or type a command."
          : "AURA could not start browser voice input. Type a command instead.");
      return false;
    }
  }

  function onVisibilityChange() {
    if (destroyed || !desiredListening) return;
    if (!isVisible()) {
      desiredListening = false;
      startAttempt += 1;
      generation += 1;
      stopRecognition();
      detachVisibility();
      emitState("paused", "AURA listens only while the app is visible.");
      return;
    }
    // A hidden-page pause requires an explicit user Resume action on return.
    emitState("paused", "Paused while the app was hidden. Tap Resume to continue.");
  }

  function stop() {
    if (destroyed) return;
    const ownedSpeech = speaking;
    desiredListening = false;
    handsFree = false;
    tapToTalkMode = false;
    busy = false;
    speaking = false;
    speechGeneration += 1;
    try { if (ownedSpeech && typeof window !== "undefined") window.speechSynthesis?.cancel(); } catch { /* Optional browser feature. */ }
    startAttempt += 1;
    generation += 1;
    restartFailures = 0;
    activeRecognitionMode = null;
    stopRecognition();
    detachVisibility();
    emitState("idle");
  }

  function setBusy(value) {
    if (destroyed) return;
    busy = Boolean(value);
    if (busy) {
      startAttempt += 1;
      if (tapToTalkMode) { desiredListening = false; detachVisibility(); }
      if ((activeRecognitionMode === "browser" && !handsFree) || (activeRecognitionMode == null && !recognition && !handsFree)) {
        desiredListening = false;
        detachVisibility();
      }
      clearRestart();
      stopRecognition();
      emitState("hearing", "AURA is checking that request…");
      return;
    }
    if (tapToTalkMode && !desiredListening && !speaking) {
      detachVisibility();
      emitState("idle", "Tap the microphone to speak again.");
      return;
    }
    if (!tapToTalkMode && (activeRecognitionMode === "local" || handsFree) && desiredListening && !speaking && isVisible() && !recognition && restartTimer == null) {
      const attempt = ++startAttempt;
      void beginListening({ allowPermissionPrompt: false, allowBrowserFallback: handsFree, recognitionMode: activeRecognitionMode, attempt, handsFreeMode: handsFree });
    }
  }

  function cancelSpeech({ resume = true } = {}) {
    if (destroyed) return;
    const ownedSpeech = speaking;
    speechGeneration += 1;
    speaking = false;
    try { if (ownedSpeech && typeof window !== "undefined") window.speechSynthesis?.cancel(); } catch { /* Optional browser feature. */ }
    if (resume && !tapToTalkMode && !busy && desiredListening && isVisible() && !recognition && restartTimer == null && (activeRecognitionMode === "local" || handsFree)) {
      const attempt = ++startAttempt;
      void beginListening({ allowPermissionPrompt: false, allowBrowserFallback: handsFree, recognitionMode: activeRecognitionMode, attempt, handsFreeMode: handsFree });
    }
  }

  function speak(text) {
    if (destroyed || !isVisible() || typeof window === "undefined" || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") return false;
    const synthesis = window.speechSynthesis;
    let voices = [];
    try { voices = synthesis.getVoices(); } catch { /* Some engines expose TTS before their voice list is ready. */ }
    const englishVoices = voices.filter((voice) => /^en(?:-|_)/i.test(voice.lang || ""));
    const localEnglishVoices = englishVoices.filter((voice) => voice.localService === true);
    const voice = localEnglishVoices.find((candidate) => LOCAL_VOICE_PREFERENCE.test(candidate.name))
      || localEnglishVoices[0] || englishVoices[0] || null;

    const utteranceGeneration = ++speechGeneration;
    speaking = true;
    if ((activeRecognitionMode === "browser" && !handsFree) || (activeRecognitionMode == null && !recognition)) {
      desiredListening = false;
      startAttempt += 1;
      detachVisibility();
    }
    clearRestart();
    stopRecognition();
    const chunks = splitSpeechIntoChunks(String(text ?? ""), 220);
    let chunkIndex = 0;
    const resume = () => {
      if (utteranceGeneration !== speechGeneration || !speaking) return;
      speaking = false;
      if (destroyed || busy) return;
      if (!desiredListening || tapToTalkMode || (activeRecognitionMode !== "local" && !handsFree)) {
        emitState("idle", activeRecognitionMode === "browser"
          ? "Browser speech is one-shot. Tap the microphone to speak again."
          : "");
        return;
      }
      if (!isVisible()) {
        startAttempt += 1;
        emitState("paused", "AURA listens only while the app is visible.");
        return;
      }
      const attempt = ++startAttempt;
      void beginListening({ allowPermissionPrompt: false, allowBrowserFallback: handsFree, recognitionMode: activeRecognitionMode, attempt, handsFreeMode: handsFree });
    };
    const speakNext = () => {
      if (utteranceGeneration !== speechGeneration || !speaking) return;
      if (chunkIndex >= chunks.length) { resume(); return; }
      const utterance = new window.SpeechSynthesisUtterance(chunks[chunkIndex++]);
      if (voice) utterance.voice = voice;
      utterance.lang = "en-US";
      utterance.rate = 1.08;
      utterance.pitch = 0.92;
      utterance.volume = 1;
      utterance.onend = speakNext;
      utterance.onerror = speakNext;
      try { synthesis.speak(utterance); } catch { resume(); }
    };
    try {
      synthesis.cancel();
      emitState("speaking");
      speakNext();
      return true;
    } catch {
      resume();
      return false;
    }
  }

  function destroy() {
    if (destroyed) return;
    const ownedSpeech = speaking;
    desiredListening = false;
    startAttempt += 1;
    destroyed = true;
    generation += 1;
    speaking = false;
    speechGeneration += 1;
    clearRestart();
    detachVisibility();
    listening = false;
    clearRecognition();
    try { if (ownedSpeech && typeof window !== "undefined") window.speechSynthesis?.cancel(); } catch { /* Optional browser feature. */ }
  }

  return {
    start,
    startTapToTalk,
    startHandsFree,
    prepare,
    startIfAllowed,
    stop,
    setBusy,
    cancelSpeech,
    speak,
    destroy,
    get listening() { return listening; },
    get enabled() { return desiredListening; },
  };
}
