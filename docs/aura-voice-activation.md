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

- `inventory`: open stock is the signed sum of `s_lts`, filtered to the verified active season and `saleyear <=` active sales year. Explicit on-hand and row/item counts retain their own metrics. Exact normalized common name and size aggregate all matching physical rows without location disambiguation. Cone/Tree/Espalier forms are excluded unless requested; fuzzy substitutions never become totals.
- `soc_reserves`: published `ph_reserves`, remaining quantity = ordered minus shipped.
- `soc_open_orders`: published, noninvoiced `ph_soc_master`, quantity = ordered.
  Both require exact plant/size and customer hints, with optional consignee. They use a spoken season or the active app season; sales-year filtering never applies. Invalid numeric values or incomplete imports prevent a confirmed total. Non-Dylan actors see only their assigned source records, after module/account checks; no Admin/Manager all-data override applies. Duplicate party names require an authorized external-ID choice.
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
Pagination and choices restart when their source scope changes. Commands carry
`appContext: { season, salesyear, settingRevision }`; the authenticated context RPC
verifies this before turn acquisition or model calls. A stale supplied context
returns 409 with the current context for one client retry; omitted context uses
the server value for cached-client compatibility. SQL checks the setting revision
again to reject a scope change during execution. SOC replies expose their metric,
season, feed/mapping revisions, completeness and `yearFilterApplied: false`.
Saved SOC responses also compare verified facts and recheck ownership before display.
Inventory replay also compares a hash of the freshly read facts, so ownership
changes cannot slip through an unchanged master-import revision. Confirmed plant
and owner choices become explicit remembered filters. Named historical totals
use the existing filtered drill-down RPC operations rather than its unfiltered
summary operation.

## Voice

Authenticated Aura accounts can choose Aoede, Charon, Fenrir, Kore or Puck in
Settings or the chat header. Kore is the default. The account-owned
`user_preferences` table uses forced RLS; `aura_voice_preferences_v1` checks
current Aura access before reading or changing the caller's preference. The
Gemini speech endpoint accepts a conversation ID and completed turn ID, rechecks
ownership and current source facts, and speaks only that stored verified answer.
Client text and client actor IDs cannot supply speech facts or another account's
voice. Audio is returned as bounded 24 kHz PCM and played in the existing
gesture-enabled audio context. Cancel, navigation and account teardown release
only Aura's own playback.

The root `WakeWordProvider` supplies a global **Standby Mode** toggle. Recognition
starts only after an explicit gesture. It recognizes "hey Aura", "hey, Aura" and
"hey Ora", suspends standby, and opens the voice panel. Interim speech never
submits a partial command. Recognition restarts with bounded backoff after
unexpected ends; denied permission, hidden pages, active panel capture, playback
and account changes stop or suspend it. Browsers without Web Speech keep typed
commands available and show standby as unsupported.

## Nursery terminology and current facts

`aura_domain_glossary` holds normalized, unique aliases and bounded catalog
filters. Baseline sizes include 3DP, 1G through 15G and B&B; gallon aliases map
to the actual `#N` catalog codes. Open Stock, On Hand, Allocated and Held map to
explicit metrics. Authenticated Aura users can read entries; only the service
role can edit them. Each query loads the glossary anew. Its revision is part of
saved-source validation, so changed aliases invalidate remembered facts without
redeploying code. Notes never become model instructions.

Before an inventory read, Aura resolves the structured size, base cultivar,
explicit form and metric. Fresh ordinary plant queries exclude cone, spiral,
pom pom, topiary, tree form and espalier rows. Explicit form queries include
only those forms. Open Stock reads verified S_LTS; Held uses verified hold/stop
rows. Allocated remains unavailable until a verified allocation source exists,
and Aura says so instead of inventing a count. Replies lead with the verified
quantity and use at most two location lines. Follow-ups fetch current facts;
remembered messages cannot authorize access or provide inventory data.

Boundary whitespace in profile roles is normalized consistently across existing
Aura authorization, inventory, SOC and conversation routines. The role allowlist,
navigation restrictions, actor identity and ownership checks remain in force.

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
the full tool schema, plus synthetic Kore speech through Gemini 3.8 Flash TTS.
Neither returned tool executes. The probe cannot query
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
