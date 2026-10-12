const WAKE = /\bhey[\s,]+(?:aura|ora)\b[\s,:-]*/i;
/** Inert until a microphone toggle is clicked. Owns only its recognition session. */
export function createWakeWordController({ getRecognition = () => globalThis.window?.SpeechRecognition || globalThis.window?.webkitSpeechRecognition,
  isAuthorized = () => false, isVisible = () => globalThis.document?.visibilityState !== 'hidden', onWake = () => {}, onState = () => {},
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  let enabled = false, suspended = false, destroyed = false, recognition = null, timer = null, epoch = 0, failures = 0;
  const notify = state => onState({ enabled, state, supported: Boolean(getRecognition()) });
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  function release() {
    epoch++; clear();
    const owned = recognition; recognition = null;
    if (owned) {
      owned.onresult = owned.onend = owned.onerror = owned.onstart = null;
      try { owned.abort(); } catch { /* Already stopped. */ }
    }
  }
  const canListen = () => enabled && !suspended && !destroyed && isAuthorized() && isVisible();
  function restart() {
    if (!canListen() || timer !== null) return;
    const ticket = epoch;
    timer = schedule(() => { timer = null; if (ticket === epoch && canListen()) begin(); }, Math.min(10000, 700 * 2 ** Math.min(failures++, 4)));
    notify('reconnecting');
  }
  function begin() {
    if (!canListen() || recognition) return false;
    const Recognition = getRecognition();
    if (!Recognition) { enabled = false; notify('unsupported'); return false; }
    const ticket = ++epoch;
    try {
      const owned = new Recognition(); recognition = owned;
      owned.continuous = true; owned.interimResults = true; owned.lang = 'en-US';
      owned.onstart = () => { if (ticket === epoch && canListen()) { failures = 0; notify('listening'); } };
      owned.onresult = event => {
        if (ticket !== epoch || !canListen()) return;
        const text = Array.from(event.results || []).slice(event.resultIndex || 0).map(result => result[0]?.transcript || '').join(' ');
        const match = WAKE.exec(text);
        if (!match) return;
        const remainder = text.slice(match.index + match[0].length).trim();
        suspended = true; release(); notify('handoff');
        const completed = Array.from(event.results || []).slice(event.resultIndex || 0).some(result => result.isFinal === true);
        Promise.resolve(onWake(remainder, { completed })).then(result => { if (result === false && !destroyed && enabled) { suspended = false; restart(); } })
          .catch(() => { enabled = false; release(); notify('unavailable'); });
      };
      owned.onerror = event => {
        if (ticket !== epoch || destroyed) return;
        if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(event.error)) {
          enabled = false; release(); notify(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'permission-denied' : 'unavailable');
        } else { release(); restart(); }
      };
      owned.onend = () => { if (ticket === epoch) { release(); restart(); } };
      owned.start(); notify('starting'); return true;
    } catch { release(); restart(); return false; }
  }
  function visibility() { if (!isVisible()) { release(); notify('paused'); } else if (canListen()) begin(); }
  globalThis.document?.addEventListener('visibilitychange', visibility);
  return {
    startFromGesture() { if (destroyed || !isAuthorized() || !isVisible()) return false; enabled = true; failures = 0; return begin(); },
    stop() { enabled = false; release(); notify('off'); },
    setSuspended(value) { suspended = Boolean(value); if (suspended) { release(); if (enabled) notify('paused'); } else if (canListen()) begin(); },
    destroy() { destroyed = true; enabled = false; release(); globalThis.document?.removeEventListener('visibilitychange', visibility); },
    get supported() { return Boolean(getRecognition()); },
    get enabled() { return enabled; },
  };
}
