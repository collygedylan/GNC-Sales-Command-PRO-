---
name: agdata-aura-assistant
description: Maintain AgData AURA voice/query UI, per-account assistant capabilities, bounded inventory/history analytics and reviewed navigation/draft actions without widening legacy assistant permissions.
---

# AURA assistant

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for Cluster 9 and shared Back/navigation ownership.

## Owned implementation boundaries

- `assets/app-runtime.js`: `syncAuraWidgetForSession`, `isAuraRouterProfileCandidate`, `isAuraRouterWidgetAuthorized`, `disposeAuraWidget`, `callAuraLlmRouter`, `requestAuraQuery`, `openAuraRouterAction`, `openAuraQueryAction`, `requestAuraV2Inventory`, `resolveAuraOrderParty`; distinct legacy `isAuraWidgetAuthorized`, `callAuraLegacyQuery`, `saveAuraScoutLog`, `sendAuraMessage`. Leaf fallback: `openLeafAssistant`, `askLeafAssistantQuestion`, `toggleLeafVoiceInput`, `closeLeafAssistant` and `syncLeafAuraAudioOwnership`.
- Source UI: `components/common/auraVoiceWidget.js`, `auraVoiceReact.tsx`, `auraQueryPanel.js` (`mountAuraQueryPanel`, `boundedAuraChatHistory`), `WakeWordProvider.tsx`; compiled `assets/aura-voice.js`. Services: `services/auraVoiceService.js`, `auraConversation.js`, `auraGeminiSpeech.js`, `auraWakeWord.js`; parsing/normalization: `utils/auraIntentParser.js`, `utils/auraLingo.js`.
- Edge endpoints: `supabase/functions/aura-llm-router/index.ts` → `_shared/aura-voice-handler.ts` / `aura-voice-store.ts` / `aura-gemini.ts` / `aura-speech.ts`; legacy `aura-query/index.ts` → `_shared/aura-query-handler.ts` / `aura-query.ts` / `aura-capabilities.ts`. Legacy Leaf uses `inventory-assistant/index.ts`.
- `app-api/index.ts` actions `aura_inventory_v2`, `aura_inventory_search`, `aura_scout_log`, `aura_chat_send`; `alpha_chat_*` also serves Comm. Backend access/conversation readers include `aura_voice_access_v1`, `aura_voice_context_v1`, `aura_voice_inventory_read_v1`, `aura_voice_soc_read_v1`, `aura_voice_conversation_v1`, `aura_domain_context_v1`, `aura_voice_preferences_v1`. Do not conflate query, LLM and app-api authorization paths.

## Shared dependencies and safeguards

- `#aura-standby-control`, `#aura-voice-settings`, `#aura-review-proposal` and Leaf overlay share shell focus, modal/back lifecycle and speech ownership. Navigation goes through `openAuraQueryAction` → `canAccessView` → `switchView`; retain `updateGlobalBackButton` / `goBackUniversal` invariants instead of changing header controls from an assistant action.
- Preserve `nativeAuthProfile`, `nativeAuthSessionActive`, `auraRouterCapabilities`, `auraWidgetOwnerKey`, `auraLoadSequence`, `getSupabaseReadIdentityScope` and abort/epoch checks. A late capability/query/speech response cannot mount or write into another account's UI. Stop owned microphone/speech activity on teardown and coordinate Leaf/AURA audio ownership.
- The current router requires server-verified per-account `auraEnabled` plus explicit inventory/history/draft/SOC capabilities. Legacy query/scout/chat paths have narrower existing actor/module rules; broadening the router rollout does not authorize widening those paths.
- The full-app administrator migration preserves the router's `auraEnabled` capability envelope for Dylan, Megan and JD; their active admin profiles receive the router's inventory/history/draft/SOC grants. Legacy identity-bound messaging still attributes actions to the verified actor and must never impersonate another administrator.
- Fixed readers/projections, bounded pages/cursors, selected season, server actor identity and RLS remain authoritative. LLM text is not executable SQL, a permission grant or proof of stock. No source says a dedicated image/vision upload endpoint is mounted here: inspect actual contracts before adding or promising one; existing scouting/photo workflows remain separate.
- Review actions navigate or prepare drafts. Preserve the explicit review-before-saving UI; never auto-submit requests/chat/inventory edits from an LLM response. Actual scout/chat mutations retain exact-row/recipient validation and idempotency identities.
- Provider keys stay server-side in environment variables. Keep bounded conversation history, cancellation, conflict revision behavior and honest provider-unavailable feedback. Do not present model-generated analytics as a new persisted business fact.

## Scoped verification

Select the affected files from this pure Node/VM/JSDOM command (target under 10 seconds; **not measured by the static audit**):

```sh
node --test tests/aura-account-rollout.test.mjs tests/aura-query-panel.test.mjs tests/aura-voice.test.mjs
```

These tests use local mocks and do not prove microphone hardware, provider availability or live auth. Follow AGENTS: no browser/Docker/database or external provider calls without the relevant authorization; changed Edge code needs the authorized focused type check.
