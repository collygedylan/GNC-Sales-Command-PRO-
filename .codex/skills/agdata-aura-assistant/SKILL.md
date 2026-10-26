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
- AURA is exclusively available to the active canonical `dylan_collyge` account, regardless of administrator role. The browser must hide the standby host and voice controls and dispose mounted UI for every other account before any capability lookup; the router, query, app-api and authenticated `aura_voice_access_v1`, `aura_voice_context_v1`, `aura_voice_inventory_read_v1` and `aura_voice_soc_read_v1` RPCs independently enforce the same owner identity. Preference and glossary RPCs inherit the access RPC guard. Keep the existing capability calculations, active-profile checks, grants and security-definer settings intact.
- The `/aura-llm-router/health` route remains a separate signed machine-only release probe: it accepts the service-role bearer and returns provider readiness only, without reading user identity, inventory, conversation or user capabilities. Do not route it through the ordinary user AURA authorization path.
- Fixed readers/projections, bounded pages/cursors, selected season, server actor identity and RLS remain authoritative. LLM text is not executable SQL, a permission grant or proof of stock. No source says a dedicated image/vision upload endpoint is mounted here: inspect actual contracts before adding or promising one; existing scouting/photo workflows remain separate.
- Review actions navigate or prepare drafts. Preserve the explicit review-before-saving UI; never auto-submit requests/chat/inventory edits from an LLM response. Actual scout/chat mutations retain exact-row/recipient validation and idempotency identities.
- Provider keys stay server-side in environment variables. Keep bounded conversation history, cancellation, conflict revision behavior and honest provider-unavailable feedback. Do not present model-generated analytics as a new persisted business fact.

## Canonical nursery glossary

- `public.aura_domain_glossary` is the canonical term store; `public.ph_aura_domain_glossary` exposes `term`, `canonical_entity`, bounded `target_filter`, `notes`, `definition`, and `synonyms`. `aura_domain_context_v1` returns that sanitized data plus a revision; neither definitions nor synonyms are executable instructions.
- Preserve the canonical terms `carry over`, `current crop`, `future crop`, `inv consolidation`, `loc photo match`, `request sales impact`, `mistake guy`, `historical orders`, `historical reserves`, `historical drive around`, `location moves`, `suspend tag`, `recount`, `bunch notes`, `eval work`, and `shear list`, including their database-defined aliases.
- Crop-tier questions resolve deterministically before provider routing. `aura_inventory_crop_tier_v1` applies the live current SalesYear and a bounded optional inventory query; the router returns verified rows and a reviewed navigation action to `inv-consolidation`. Other glossary features return the stored definition and an authorized navigation action through the shared shell.

## Scoped verification

Select the affected files from this pure Node/VM/JSDOM command (target under 10 seconds; **not measured by the static audit**):

```sh
node --test tests/aura-account-rollout.test.mjs tests/aura-query-panel.test.mjs tests/aura-voice.test.mjs
```

These tests use local mocks and do not prove microphone hardware, provider availability or live auth. Follow AGENTS: no browser/Docker/database or external provider calls without the relevant authorization; changed Edge code needs the authorized focused type check.

## Application conflict errors

Revision conflicts must use PT409, never custom 40001. The v2.3.34 application_conflict_retry_guard migration preserves existing RPC permissions and retry catches; Edge handlers recognize both real serialization failures and HTTP conflicts.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/app-runtime.js`: `syncAuraWidgetForSession`, `requestAuraQuery`, `openAuraQueryAction`, `parseAuraDeterministicInventoryQuestion`; `supabase/functions/app-api/index.ts`: `handleAuraInventoryV2`, `handleAuraInventorySearch`, `handleAuraScoutLog`, `parseAuraDeterministicInventoryQuestion`; AURA Edge handlers and the `aura_voice_*` / `aura_domain_context_v1` / `aura_inventory_crop_tier_v1` RPC family.
- Canonical symbols and their owning skill are recorded in `docs/architecture/agdata-symbol-index.json`; legacy Leaf/assistant functions remain a separate permission boundary.

## Cross-Layer Blast Radius

- Trace voice/query state through account capability, app-api/Edge authorization, bounded SQL readers, reviewed navigation/drafts, shared modal/Back ownership, and watchdog incident mapping. AURA availability must never delay Home or another authorized module.

## Forbidden Anti-Patterns (Never Repeat)

- Never broaden AURA beyond canonical `dylan_collyge`, execute model text as SQL, auto-submit a mutation, expose provider keys, or merge the legacy assistant permission path into AURA.
- Never turn provider, capability, or conversation refresh failure into a shell lockout or a production source write by an AI/watchdog path.
- Never hardcode crop-tier facts in model prose, bypass the glossary revision, mix Carry Over/Current/Future predicates, or navigate without the existing `canAccessView` shell gate.
