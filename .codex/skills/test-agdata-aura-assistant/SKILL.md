---
name: test-agdata-aura-assistant
description: Maintain AgData AURA voice/query UI, per-account assistant capabilities, bounded inventory/history analytics and reviewed navigation/draft actions without widening legacy assistant permissions.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# AURA assistant

Read [the canonical dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) for Cluster 9 and shared Back/navigation ownership.

## Owned implementation boundaries

- `test/assets/app-runtime.js`: `syncAuraWidgetForSession`, `isAuraRouterProfileCandidate`, `isAuraRouterWidgetAuthorized`, `disposeAuraWidget`, `callAuraLlmRouter`, `requestAuraQuery`, `openAuraRouterAction`, `openAuraQueryAction`, `requestAuraV2Inventory`, `resolveAuraOrderParty`; distinct legacy `isAuraWidgetAuthorized`, `callAuraLegacyQuery`, `saveAuraScoutLog`, `sendAuraMessage`. Leaf fallback: `openLeafAssistant`, `askLeafAssistantQuestion`, `toggleLeafVoiceInput`, `closeLeafAssistant` and `syncLeafAuraAudioOwnership`.
- Source UI: `test/components/common/auraVoiceWidget.js`, `auraVoiceReact.tsx`, `auraQueryPanel.js` (`mountAuraQueryPanel`, `boundedAuraChatHistory`), `WakeWordProvider.tsx`; compiled `test/assets/aura-voice.js`. Services: `test/services/auraVoiceService.js`, `auraConversation.js`, `auraGeminiSpeech.js`, `auraWakeWord.js`; parsing/normalization: `test/utils/auraIntentParser.js`, `test/utils/auraLingo.js`.
- Edge endpoints: `test/supabase/functions/aura-llm-router/index.ts` → `_shared/aura-voice-handler.ts` / `aura-voice-store.ts` / `aura-gemini.ts` / `aura-speech.ts`; legacy `aura-query/index.ts` → `_shared/aura-query-handler.ts` / `aura-query.ts` / `aura-capabilities.ts`. Legacy Leaf uses `inventory-assistant/index.ts`.
- `app-api/index.ts` actions `aura_inventory_v2`, `aura_inventory_search`, `aura_scout_log`, `aura_chat_send`; `alpha_chat_*` also serves Comm. Backend access/conversation readers include `test_aura_voice_access_v1`, `test_aura_voice_context_v1`, `test_aura_voice_inventory_read_v1`, `test_aura_voice_soc_read_v1`, `test_aura_voice_conversation_v1`, `test_aura_domain_context_v1`, `test_aura_voice_preferences_v1`. Do not conflate query, LLM and app-api authorization paths.

## Shared dependencies and safeguards

- `#aura-standby-control`, `#aura-voice-settings`, `#aura-review-proposal` and Leaf overlay share shell focus, modal/back lifecycle and speech ownership. Navigation goes through `openAuraQueryAction` → `canAccessView` → `switchView`; retain `updateGlobalBackButton` / `goBackUniversal` invariants instead of changing header controls from an assistant action.
- Preserve `nativeAuthProfile`, `nativeAuthSessionActive`, `auraRouterCapabilities`, `auraWidgetOwnerKey`, `auraLoadSequence`, `getSupabaseReadIdentityScope` and abort/epoch checks. A late capability/query/speech response cannot mount or write into another account's UI. Stop owned microphone/speech activity on teardown and coordinate Leaf/AURA audio ownership.
- AURA is exclusively available to the active canonical `dylan_collyge` account, regardless of administrator role. The browser must hide the standby host and voice controls and dispose mounted UI for every other account before any capability lookup; the router, query, app-api and authenticated `test_aura_voice_access_v1`, `test_aura_voice_context_v1`, `test_aura_voice_inventory_read_v1` and `test_aura_voice_soc_read_v1` RPCs independently enforce the same owner identity. Preference and glossary RPCs inherit the access RPC guard. Keep the existing capability calculations, active-profile checks, grants and security-definer settings intact.
- The `/aura-llm-router/health` route remains a separate signed machine-only release probe: it accepts the service-role bearer and returns provider readiness only, without reading user identity, inventory, conversation or user capabilities. Do not route it through the ordinary user AURA authorization path.
- Fixed readers/projections, bounded test/pages/cursors, selected season, server actor identity and RLS remain authoritative. LLM text is not executable SQL, a permission grant or proof of stock. No source says a dedicated image/vision upload endpoint is mounted here: inspect actual contracts before adding or promising one; existing scouting/photo workflows remain separate.
- Review actions navigate or prepare drafts. Preserve the explicit review-before-saving UI; never auto-submit requests/chat/inventory edits from an LLM response. Actual scout/chat mutations retain exact-row/recipient validation and idempotency identities.
- Provider keys stay server-side in environment variables. Keep bounded conversation history, cancellation, conflict revision behavior and honest provider-unavailable feedback. Do not present model-generated analytics as a new persisted business fact.

## Canonical nursery glossary

- `public.test_aura_domain_glossary` is the canonical term store; `public.test_ph_aura_domain_glossary` exposes `term`, `canonical_entity`, bounded `target_filter`, `notes`, `definition`, and `synonyms`. `test_aura_domain_context_v1` returns that sanitized data plus a revision; neither definitions nor synonyms are executable instructions.
- Preserve the canonical terms `carry over`, `current crop`, `future crop`, `inv consolidation`, `loc photo match`, `request sales impact`, `mistake guy`, `historical orders`, `historical reserves`, `historical drive around`, `location moves`, `suspend tag`, `recount`, `bunch notes`, `eval work`, and `shear list`, including their database-defined aliases.
- Crop-tier questions resolve deterministically before provider routing. `test_aura_inventory_crop_tier_v1` applies the live current SalesYear and a bounded optional inventory query; the router returns verified rows and a reviewed navigation action to `inv-consolidation`. Other glossary features return the stored definition and an authorized navigation action through the shared shell.

## Scoped verification

Select the affected files from this pure Node/VM/JSDOM command (target under 10 seconds; **not measured by the static audit**):

```sh
node --test test/tests/aura-account-rollout.test.mjs test/tests/aura-query-panel.test.mjs test/tests/aura-voice.test.mjs
```

These tests use local mocks and do not prove microphone hardware, provider availability or live auth. Follow AGENTS: no browser/Docker/database or external provider calls without the relevant authorization; changed Edge code needs the authorized focused type check.

## Application conflict errors

Revision conflicts must use PT409, never custom 40001. The v2.3.34 application_conflict_retry_guard migration preserves existing RPC permissions and retry catches; Edge handlers recognize both real serialization failures and HTTP conflicts.

## Owned Files, Canonical Functions & SQL Contracts

- `test/assets/app-runtime.js`: `syncAuraWidgetForSession`, `requestAuraQuery`, `openAuraQueryAction`, `parseAuraDeterministicInventoryQuestion`; `test/supabase/functions/app-api/index.ts`: `handleAuraInventoryV2`, `handleAuraInventorySearch`, `handleAuraScoutLog`, `parseAuraDeterministicInventoryQuestion`; AURA Edge handlers and the `aura_voice_*` / `test_aura_domain_context_v1` / `test_aura_inventory_crop_tier_v1` RPC family.
- Canonical symbols and their owning skill are recorded in `test/docs/architecture/test-agdata-symbol-index.json`; legacy Leaf/assistant functions remain a separate permission boundary.

## Cross-Layer Blast Radius

- Trace voice/query state through account capability, app-api/Edge authorization, bounded SQL readers, reviewed navigation/drafts, shared modal/Back ownership, and watchdog incident mapping. AURA availability must never delay Home or another authorized module.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `test/workers/email/Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `test_ph_app_users` and `test_user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never broaden AURA beyond canonical `dylan_collyge`, execute model text as SQL, auto-submit a mutation, expose provider keys, or merge the legacy assistant permission path into AURA.
- Never turn provider, capability, or conversation refresh failure into a shell lockout or a production source write by an AI/watchdog path.
- Never hardcode crop-tier facts in model prose, bypass the glossary revision, mix Carry Over/Current/Future predicates, or navigate without the existing `canAccessView` shell gate.

- Never probe the AURA router when the current safe access matrix explicitly denies use_aura_assistant; preserve server-verified per-account rollout for allowed accounts rather than hard-coding a username. The current rollout supersedes the legacy owner-only browser rule above.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Maintain AgData AURA voice/query UI, per-account assistant capabilities, bounded inventory/history analytics and reviewed navigation/draft actions without widening legacy assistant permissions.

### Exact ownership
- test/assets/app-runtime.js: syncAuraWidgetForSession, requestAuraQuery, parseAuraDeterministicInventoryQuestion, requestAuraDeterministicInventoryAnswer, openAuraRouterAction.
- test/assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: handleAuraInventoryV2, handleAuraInventorySearch, handleAuraScoutLog, parseAuraDeterministicInventoryQuestion.
- Code.gs: module contract.
- supabase/functions/_shared/aura-domain.ts: parseAuraGlossary, matchesAuraGlossaryEntry, extractAuraEntity.
- supabase/functions/_shared/aura-voice-handler.ts: deterministicGlossaryTool, domainOutcome.
- supabase/functions/_shared/aura-inventory.ts: auraInventoryV2Rpc.
- supabase/migrations/20261026020000_agdata_v2367_crop_tier_aura_glossary.sql: aura_domain_context_v1, aura_inventory_crop_tier_v1.
- DOM: #aura-standby-control, #aura-voice-settings, #aura-review-proposal
- PostgreSQL: test_ph_aura_domain_glossary, test_ph_app_users
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-aura-assistant, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-aura-assistant.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
