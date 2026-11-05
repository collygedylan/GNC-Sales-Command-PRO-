export function auraPcmWave(base64) {
  if (typeof base64 !== 'string' || base64.length > 7800000) throw new Error('Voice audio is invalid.');
  const pcm = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  if (!pcm.length || pcm.length % 2) throw new Error('Voice audio is invalid.');
  const buffer = new ArrayBuffer(44 + pcm.length), view = new DataView(buffer);
  const word = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, pcm.length, true); new Uint8Array(buffer, 44).set(pcm);
  return buffer;
}
/** Uses the widget's gesture-enabled AudioContext and releases only owned audio. */
export function createAuraGeminiSpeech({ request, getAudioContext, isCurrent, claimAudio, onError = () => {} }) {
  let controller = null, source = null, release = null, epoch = 0, destroyed = false;
  function cancel() {
    epoch++; controller?.abort(); controller = null;
    if (source) { source.onended = null; try { source.stop(); source.disconnect(); } catch { /* Already stopped. */ } source = null; }
    release?.(); release = null;
  }
  async function speak(identity) {
    cancel();
    if (destroyed || !isCurrent() || !identity?.conversationId || !identity?.turnId) return false;
    const ticket = epoch, ownedController = new AbortController(); controller = ownedController;
    release = claimAudio('aura-gemini-speech');
    try {
      const response = await request({ mode: 'speech', conversationId: identity.conversationId, turnId: identity.turnId }, { signal: ownedController.signal });
      if (destroyed || ticket !== epoch || !isCurrent() || ownedController.signal.aborted) return false;
      if (!response?.ok || !/^audio\/(?:L16|pcm);(?:codec=pcm;)?rate=24000$/i.test(response.audio?.mimeType || '')) throw new Error('Voice audio is unavailable.');
      const context = getAudioContext();
      if (!context) throw new Error('Voice audio is unavailable.');
      await context.resume();
      const decoded = await context.decodeAudioData(auraPcmWave(response.audio.base64));
      if (destroyed || ticket !== epoch || !isCurrent() || ownedController.signal.aborted) return false;
      const owned = context.createBufferSource(); source = owned; owned.buffer = decoded; owned.connect(context.destination);
      owned.onended = () => { if (ticket === epoch) cancel(); };
      owned.start(); return true;
    } catch {
      if (ticket === epoch && isCurrent() && !ownedController.signal.aborted) onError('Voice audio could not load. The verified answer is shown.');
      return false;
    } finally { if (ticket === epoch && !source) cancel(); }
  }
  return { speak, cancel, destroy() { destroyed = true; cancel(); } };
}
