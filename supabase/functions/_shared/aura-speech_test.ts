// @test-group: aura
import { synthesizeAuraSpeech, AURA_TTS_MODEL } from "./aura-speech.ts";
import type { AuraVoice } from "./aura-domain.ts";
const assert = (value: unknown) => { if (!value) throw new Error("Assertion failed"); };
Deno.test("Gemini speech uses the verified per-user voice and reserves quota exactly once", async () => {
  for (const voice of ["Aoede", "Charon", "Fenrir", "Kore", "Puck"] as AuraVoice[]) {
    let reservations = 0;
    const audio = await synthesizeAuraSpeech({ text: "We currently have 420 Baby Gem Boxwoods in Open Stock.", voice, apiKey: "synthetic-key", signal: new AbortController().signal,
      reserve: async bytes => { assert(bytes > 0); reservations++; },
      fetcher: async (url, init) => {
        assert(String(url).includes(AURA_TTS_MODEL) && !String(url).includes("synthetic-key"));
        const body = JSON.parse(String(init?.body));
        assert(body.generationConfig.temperature === 0.3);
        assert(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === voice);
        assert(body.contents[0].parts[0].text.startsWith("We currently have 420"));
        return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: "AAAAAA==" } }] } }] });
      } });
    assert(audio.voiceName === voice && reservations === 1);
  }
});
Deno.test("speech refuses malformed or non-audio provider output and never reflects provider errors", async () => {
  for (const response of [Response.json({ candidates: [] }), Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "invented stock" }] } }] }),
    Response.json({ error: "private-provider-detail" }, { status: 503 })]) {
    let rejected = false;
    try { await synthesizeAuraSpeech({ text: "I cannot find that information.", voice: "Kore", apiKey: "synthetic-key", signal: new AbortController().signal,
      reserve: async () => {}, fetcher: async () => response }); } catch (error) { rejected = true; assert(!String(error).includes("private-provider-detail")); }
    assert(rejected);
  }
});
