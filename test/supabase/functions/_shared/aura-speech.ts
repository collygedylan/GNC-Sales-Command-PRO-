import { AURA_PROVIDER_TIMEOUT_MS, AuraGeminiProviderError, auraObject } from "./aura-gemini.ts";
import { auraVoice, type AuraVoice } from "./aura-domain.ts";

export const AURA_TTS_MODEL = "gemini-3.8-flash-tts";
/** The caller supplies a freshly authorized stored reply, never client-written facts. */
export async function synthesizeAuraSpeech(input: { text: string; voice: AuraVoice; apiKey: string; signal: AbortSignal;
  fetcher?: typeof fetch; reserve: (bytes: number) => Promise<void> }) {
  if (!input.apiKey.trim()) throw new Error("AURA_GEMINI_CONFIGURATION_UNAVAILABLE");
  if (!input.text.trim() || input.text.length > 2000) throw new Error("AURA_SPEECH_INVALID");
  const voice = auraVoice(input.voice);
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: input.text }] }],
    generationConfig: { temperature: 0.3, responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } });
  await input.reserve(new TextEncoder().encode(body).byteLength);
  const response = await (input.fetcher || fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${AURA_TTS_MODEL}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey }, body,
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(AURA_PROVIDER_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new AuraGeminiProviderError(response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("AURA_SPEECH_INVALID");
  let raw = "", bytes = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8000000) throw new Error("AURA_SPEECH_INVALID");
      raw += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const payload = auraObject(JSON.parse(raw + decoder.decode()));
  if (!Array.isArray(payload.candidates) || payload.candidates.length !== 1) throw new Error("AURA_SPEECH_INVALID");
  const candidate = auraObject(payload.candidates[0]), content = auraObject(candidate.content);
  if (candidate.finishReason !== "STOP" || !Array.isArray(content.parts) || content.parts.length !== 1) throw new Error("AURA_SPEECH_INVALID");
  const audio = auraObject(auraObject(content.parts[0]).inlineData);
  if (typeof audio.data !== "string" || !audio.data.length || audio.data.length > 7800000
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio.data)
    || typeof audio.mimeType !== "string" || !/^audio\/(?:L16|pcm);(?:codec=pcm;)?rate=24000$/i.test(audio.mimeType)) throw new Error("AURA_SPEECH_INVALID");
  return { base64: audio.data, mimeType: audio.mimeType, voiceName: voice };
}
