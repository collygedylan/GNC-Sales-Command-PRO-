# AURA natural-language tools — V2026.10.01.011

Implementation: `.011` adds the authenticated `aura-llm-router` and keeps `.010` speech capture. Provider activation is independent of deployment and stays disabled when its secret or quota configuration is missing. Only the verified active `dylan_collyge` native account can call the router.

## Flow

Transcript → authenticated AURA Edge handler → Gemini function selection → validated inventory/order tools → grounded response and cards.

Verify the active native session and exact Dylan profile before any provider call. Store the Gemini key in Edge Function secrets. The model selects a function and structured arguments; application code validates and executes them. See [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling).

## Tool contracts

| Tool | Bounded server operation |
| --- | --- |
| `check_open_stock` | Reuse `.010` scoped matching; ambiguous products produce choices. Count only through the authoritative aggregate. |
| `lookup_lot_code` | Exact lot code; up to 100 rows with an explicit continuation indicator. A page is never a complete quantity total. |
| `draft_order` | Bind the selected customer internally, resolve items and priority lots, validate cumulative quantities and exact rows, then prepare Bloom Picker review. |

Validate strict JSON schemas, lengths, allowed seasons and metrics independently of the provider. No raw SQL or unrestricted column parameters. Never expose service credentials to the model. Ambiguous identities require selection; order submission remains manual. Existing chat, scouting, maximum-inventory and local conversation controls keep their deterministic handlers.

## Grounding and budgets

Send inventory product/size/lot/location/quantity fields and bounded tool results. Keep customer names and identifiers, addresses, messages and scouting notes out of provider requests. Bind the selected customer separately inside the application; Gemini receives only a fixed alias. Build numerical speech and cards from verified results, preserving incomplete data, unknown values and ties. Do not transmit entire inventory catalogs.

The complete command has a 15-second deadline including authentication and queueing. There are at most two provider attempts (four seconds each) and five tool calls. There is no automatic provider retry. When verified data is already available, a failed second phrasing call returns a deterministic response.

`aura_private.llm_provider_calls` records only request ID, round, time and reserved input tokens. The service-only `aura_llm_reserve_call_v1` serializes quota reservations across Edge instances. Every provider attempt consumes quota, including failed attempts; second calls count separately. Limits cover rolling-minute requests and input tokens, plus daily requests resetting at America/Los_Angeles midnight. The hard request ceiling is 15 per rolling minute, further limited by configured model quotas. No browser role can access the ledger or reserve quota.

Diagnostics contain operation, correlation ID, duration, status and usage counts only. Exclude raw transcripts, customer details, message bodies and tool payloads.

## Activation and rollback

The planned model is pinned to `gemini-3.8-flash`, with low thinking, standard service and no paid-model fallback. Use a dedicated, unbilled Google AI Studio project. A limiter does not make a billed project free. Free Tier project/model quotas must be read from that project's AI Studio limits; retired `gemini-1.5-flash` limits are not evidence of another model's limits.

Set secrets directly in the production Supabase project after verifying the project reference. Never put secret values in source, PRs, browser configuration or logs:

- `GEMINI_API_KEY`: key from the dedicated unbilled project.
- `AURA_LLM_RPM`: actual project/model RPM, at most 15.
- `AURA_LLM_TPM`: actual project/model input TPM.
- `AURA_LLM_RPD`: actual project/model daily requests.
- `AURA_LLM_ENABLED`: keep `false` until the key, available model and quotas are verified. Enable for the controlled authenticated Dylan inventory check, and leave it enabled only if that check succeeds; otherwise immediately restore `false`.

Keep activation off until the model and key can be checked. To deactivate, set `AURA_LLM_ENABLED=false`; existing deterministic handlers and typed-command fallback remain available. Do not remove quota history to bypass a provider limit.

The guarded release applies the additive migration and deploys `app-api` plus `aura-llm-router` before Pages. Production activation requires a real authenticated end-to-end check; mocked provider tests do not establish key, model or physical Android compatibility.

## Verification

Focused tests cover authorization denials, provider budgets, malicious arguments, ambiguous matches, unknown quantities, draft review, cancellation and grounding. Isolated SQL checks cover quota permissions, duplicate attempts, rolling windows, Pacific daylight-saving reset, missing values and lot paging. Database CI also sends 30 concurrent reservations through separate local Postgres connections and verifies exactly 15 are admitted.

Google Drive ML synchronization remains deferred.
