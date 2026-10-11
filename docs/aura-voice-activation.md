# Aura voice activation

## Runtime and trust boundary

`aura-llm-router` is the authenticated Gemini tool router. The pinned model is
`gemini-3.8-flash`. `aura-query` remains the deterministic, Dylan-only legacy
endpoint so cached clients retain their original contract.

The router validates the bearer with Supabase Auth, then reads current profile,
account and navigation permissions through `aura_voice_access_v1` before reading
the request body or conversations. Stored roles, never user metadata or model
arguments, determine access. Inventory and Historical Requests use the caller's
JWT. Conversations are private and actor-owned; only the service-side handler can
commit an assistant response. The same revision, lease, cancellation and retry
protections apply to each turn.

Eligible stored roles are Admin, Administrator, Manager, Rep, SalesRep and CSR;
the exact `dylan_collyge` identity retains its legacy-role exception. Inventory
requires Drive or AV access, history requires Historical Requests access, and
drafts additionally require Request access. REP/SALESREP/CSR inventory excludes
U3 seasons and `.U3` lots. Disabled, locked or password-change-required accounts
are rejected before any conversation or provider access.

The provider gets the bounded question, verified actor/capability context and
previous resolved query parameters. It receives no database credentials or result
rows. Gemini must return exactly one declared tool call. The server rejects
unknown fields, arbitrary identifiers for authorization, SQL, additional calls,
truncated provider output and unrelated queries. It builds final text from
verified database results; provider prose never becomes an answer.

Every provider interaction starts with the approved Green Leaf Nursery AURA
system prompt. The fixed execution contract follows it and keeps authentication,
authorization and draft confirmation under server control.

## Tools

- `inventory`: available/on-hand totals, locations, lots and ownership using the
  existing common-name-priority matcher and Managers season rules. Preserve
  leading-zero item codes, fuzzy clarification and unresolved counts.
- `history`: the existing `historical_requests_read_v1` RPC. Reps see their own
  assigned requests; exact Dylan/Admin access can see all. Other Managers do not
  inherit global historical access. Current list price and the exact 25-unit
  missing/zero-quantity fallback remain unchanged. Customer/consignee drill-down
  pages have five selectable choices, with explicit pagination.
- `draft_request`: verify the selected inventory row and available quantity,
  collect Customer, Consignee and Qty, then ask for explicit confirmation.
  Confirmation rechecks the inventory identity and scope before opening a
  proposal in Request. The existing workflow validates customer/consignee mapping
  and performs final confirmation and saving. Aura never sends or changes stock.
- `clarify` and `refuse`: fixed prompts for ambiguity and unsupported topics.

Saved responses are revalidated before display or retry replay. Changed policy,
inventory revision, season setting or request revision requires a fresh query.
Pagination and choices restart when their source scope changes.
Inventory replay also compares a hash of the freshly read facts, so ownership
changes cannot slip through an unchanged master-import revision. Confirmed plant
and owner choices become explicit remembered filters. Named historical totals
use the existing filtered drill-down RPC operations rather than its unfiltered
summary operation.

## Voice

The shared browser voice service owns microphone capture across navigation and
panel closure. It supports one-shot tap-to-talk and optional foreground hands-free
recognition, wake phrases, bounded capture and Leaf audio coordination. Only
voice-origin submissions play native speech; typing and clicked follow-ups remain
silent. Hidden pages, account changes and cancellation stop recognition/playback.
React owns the widget lifecycle without creating a second recognition session.

## Deployment and operations

Set `GEMINI_API_KEY` in the production Supabase Edge Function secrets. Never put
it in a frontend environment variable, tracked file or chat. The existing
Supabase URL, anon key and service-role key are also required. The global provider
ledger bounds ordinary traffic to 15 attempts/minute, 100,000 conservative input
token units/minute and 1,000 attempts/day. Failed attempts count; no silent model
fallback is configured. Missing credentials, rate limits and provider outages
produce actionable service errors, never an empty-stock answer. Provider calls
have a 20-second deadline within the 27-second request deadline; no automatic
provider retry is added to microphone interactions.

GitHub Actions deploys database changes and both Aura functions before Pages.
Its authorization smoke requires 403 for missing/invalid bearer tokens. The
release-only `/aura-llm-router/health` probe requires the exact service credential
and performs synthetic refusal and inventory-routing checks against Gemini using
the full tool schema. Neither returned tool executes. The probe cannot query
inventory, history or conversations, and returns only readiness metadata. PWA publication
fails if the real model/key is unavailable. The probe never logs keys or payloads.

Rollback keeps private conversations and the internal deterministic endpoint.
Do not broaden Historical Requests grants or replace role predicates to recover
a provider outage. Repair the provider configuration or publish the prior
validated frontend through the normal release process.

## Evidence

Unit/Edge tests cover malformed tool calls, permission denial before body reads,
explicit identifiers/seasons, refusal, provider failures, current quantities,
draft-only writes, replay, history revalidation and changed pagination scopes.
SQL tests cover active profiles, navigation/role restrictions, inventory scope,
private conversation ownership and historical rep/global isolation. Voice mount
and browser checks cover listening/processing/responding, teardown and stale
capture/playback. Run the project TypeScript, lint, discovered Edge tests and the
disposable SQL gate before submitting a candidate.

Provider reference: [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
and [function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling).
