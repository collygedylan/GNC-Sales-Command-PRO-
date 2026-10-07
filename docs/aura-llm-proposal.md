# Aura internal conversational query engine

This replaces the `.011` Gemini proposal. Aura uses a deterministic TypeScript parser, fixed Supabase readers, PostgreSQL product matching, and response templates. It requires no AI provider key, quota reservation, or external formatter. Browser speech recognition remains an optional browser service and may use the network.

## Authorization and execution

The PWA calls `aura-query` with its native Supabase bearer token. The function validates the token with Auth, then checks the stored profile's exact `dylan_collyge` username, account activity, lock, and password-change state before reading the request body or private data. Authentication failures return 403.

The private conversation RPC acquires a bounded turn lease. The parser resolves supported wording into typed filters; the fixed capability registry selects a reader. Module permissions remain independent. Ordinary reads use the user's JWT and RLS; chat also checks current membership. Privileged readers use narrow contracts and active-account checks. Verified results are formatted directly.

Changes produce proposals for review in existing app screens. Aura never saves business changes or approves releases. `aura-llm-router` delegates to this same internal engine for cached clients. Neither endpoint calls the separate Inventory Assistant or its optional formatter.

## Capability registry

`supabase/functions/_shared/aura-capabilities.ts` defines fixed projections, permission modules, vocabulary and review destinations. `AURA_MODULE_CAPABILITIES` covers the navigation catalog. Can Filling and Order Pulling remain unavailable because the app has not implemented them.

| Area | Reader scope |
| --- | --- |
| Inventory, Drive, AV, reserves, low stock | Stock, locations, lots, published availability, reserves, existing low-stock calculations |
| Eval, Tasks, QC, Review | Effective Eval ownership, Eval Work, Location Work, dock checks, change requests |
| Warehouse and production | Bunch counts, shear, take-back, propagation, planting, stored production schedules |
| Sales and fulfillment | Customers, active requests/history, sales-office work, credits, dock trips |
| Purchasing and crop planning | Seasonal PO projections, HL records, crop-roll runs and rows |
| Grower, pest, weather, marketing, reports | Recorded observations, stored weather, materials, productivity, inventory transactions |
| Communication and HR | Participant-authorized chat, calendar/time off, employees, recorded hours |
| Settings, access, operations | Visible settings, authorized accounts, Operations tasks, permitted navigation |

Unsupported or ambiguous wording produces clarification. Commands cannot supply SQL, table names or arbitrary columns. Page summaries identify their scope; a page is not an inventory quantity total.

## Nursery rules

- Itemcodes remain strings, including leading zeros. Quantity, container size, lot and bay are distinct fields.
- Exact identifiers and reviewed aliases precede fuzzy choices. Misspellings require selection; choices are bounded to five.
- `warehousei` is an assignment-table column in `public`. Eval ownership stays on its normalized ItemCode/genus mapping and recorded work membership. Aura's current-inventory ownership uses `ph_inventory_row_assignments` by exact `ph_master_inventory.unique_id` when the row-assignment policy is active; before activation it uses the legacy Eval assignment view. An active-policy row that is missing or explicitly unassigned never inherits a sibling ItemCode/genus owner.
- Perennial physical location and policy-derived ownership are separate filters. The existing zone function controls C.06/C.07, D.04–D.09 and D.10 bays 000–021. Effective ownership retains rose exemptions.
- Explicit Unassigned ownership is separate from missing or conflicting ownership.
- “How many” defaults to available quantity. On-hand quantity, physical rows and distinct items require explicit wording. Unknown quantities remain unknown, and assignment joins cannot multiply totals.
- Explicit filters override memory. Clear follow-ups reuse resolved filters and requery current data. Relative dates use America/Chicago.

## Conversations and PWA contract

`aura_private` stores Auth-user-owned conversations and turns until deletion. Deletion cascades to turns and context. Browser roles cannot directly read these tables. History and conversation lists are paginated.

The API preserves `reply`, `speech` and `actions`, with conversation ID, revision, interpreted filters, choices, source information and pagination. Retries use the same turn ID. Database serialization and revision checks control concurrent turns; cancellation prevents late completion from replacing context. Stored sensitive results are checked against current permissions before display.

The PWA includes New chat, Conversations, resume, Delete chat and Stop. Transcripts are not stored in shared browser caches. Review cards carry prepared text and filters into app screens. Chat drafts remain unsent. Release/merge requests open the dedicated Operations composer.

## Deployment and rollback

The existing database release pipeline applies the additive migration and runs isolated SQL, Edge, parser, registry and browser checks. `apps-script-sync.yml` deploys `aura-query` and the compatibility endpoint before publishing the PWA. A production authorization smoke requires 403 for missing/invalid-token query, history and deletion requests on both routes. GitHub Actions owns production validation and publishing.

Required Edge secrets are the existing Supabase URL, service-role key and anon key. No Gemini flags or quota configuration are required. Historical provider quota records remain outside Aura's execution path.

Rollback must retain both internal endpoints and all private conversations. Roll back PWA assets or deploy a corrected internal handler; do not restore the `.011` provider handler or drop history. Cached clients must continue to reach the internal compatibility route.

## Verification

CI runs parser and Edge authorization/dispatch tests, private-conversation and nursery SQL cases, registry/schema coverage, PWA unit tests, and the Aura browser flow in Chromium, Firefox and WebKit. Production probes execute only on release runners. Local fixture tests do not establish that production has deployed successfully.
