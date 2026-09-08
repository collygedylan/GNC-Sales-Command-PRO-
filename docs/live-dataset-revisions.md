# Production live-data consistency

## Contract

The production root PWA uses `assets/live-sync-registry.js` to declare physical
database dependencies for views, subviews, badges and data-bearing dialogs.
`assets/live-sync-adapters.js` provides read/stage/commit adapters; the production
bindings remain beside the existing renderers in `index.html`.

`get_my_dataset_revisions_v1` returns one database snapshot containing the current
permission version and permitted sources' decimal-string revisions, readiness and
timestamps. It deduplicates source keys, accepts at most 64 distinct keys, and
rejects unknown keys. It does not grant access to any business table. Missing or
denied sources are unavailable, never successful empty results.

The client subscribes to the small `app_dataset_revisions` table. A socket is an
invalidation hint, not evidence that inventory is current. A foreground 30-second
revision check runs even with a healthy socket. View entry, visibility restoration,
page restoration, reconnect and authentication refresh request an immediate check.
Signals coalesce; an immediate signal supersedes a delayed one. Hidden sessions
unsubscribe and stop polling. No full-data read is needed for unchanged revisions.
Zero-row insert/update/delete statements do not advance revisions. Statement
transition tables distinguish actual affected rows from empty maintenance work;
import-token validation still applies even when a statement affects no rows.

For a changed visible dependency or badge, the client stages a complete read,
then verifies the same ready revision vector before applying it. Account, role,
division, permission and query changes reject superseded work. The low-level
shared-read cache also includes account and staged-read generations, so a read
started before the revision check cannot be reused as a newly verified snapshot.
Revisions are strings, avoiding JavaScript integer precision loss.

AV and inventory share one authoritative master read; AV is derived locally,
not downloaded a second time. Settings-only changes reuse that master only when
its session scope, permission version and ready source revision are still verified.
An old disk cache is never promoted to verified data merely because it was complete.

Read-only refreshes do not reconcile, complete, reserve or otherwise mutate
business records. Actual user commands retain their existing protected APIs.
Authoritative refreshes replace collections/maps, including deleted records;
network or malformed-response failures retain old data with a warning.

## Freshness and drafts

The independent freshness control reports **Up to date**, **Syncing**,
**Importing**, **Offline**, or **Needs attention**, with the last verified time.
It never derives “Up to date” from socket status. A new session without a
verified snapshot says so explicitly while an import is incomplete.

Filters remain in user-scoped local storage on each device. Docks **All** includes
future imported customers/reps. **Custom** is an explicit selection, including an
empty selection that matches nothing. Legacy nonempty selections migrate to
Custom without guessing whether the user originally meant All. Temporarily absent
selected options remain selected. The Docks summary exposes active restrictions,
shown/total row counts and **Clear Docks filters**, and says “Saved on this device.”

Refreshes preserve scroll and avoid replacing active edit dialogs/details. Changed
source data is flagged for review while a draft remains open. Navigation/static
screens are not rebuilt because unrelated badge data changed.

## Import fence

The service-only import APIs mark all affected registered sources importing before
the first write. A private run token and heartbeat lease fence writes and finish.
Chunks and heartbeats do not publish per-row notifications. A ready revision is
published after accepted chunks, pruning and required derived reconciliation.
Failure or lease expiry remains interrupted until a canonical recovery succeeds.

This is **not whole-file atomicity**. Import writes still use multiple database
transactions; clients deliberately keep their last verified snapshot while those
transactions run. The release does not introduce staging-and-swap tables, rewrite
inventory accounting or remove completion history.

Recovery is canonical-source aware: a later import with overlapping derived
tables cannot clear another failed file's fence. Replay the failed canonical
stage first (for example, the CAV stage after a failed CAV run), then resume the
full importer. The existing manual full-sync sequence stops on its first failure;
this release does not automatically reorder its stages.

## Traffic budget and measured limits

An idle visible session makes approximately two small revision calls per minute;
view changes, reconnects and real changes add coalesced calls. Hidden sessions
make none. A changed snapshot is checked again after the full read. Unchanged
revisions cause zero full dataset reads in the executable coordinator/browser tests.

The actual isolated Supabase test measures one importing and one ready metadata
event per subscribed, authorized device for a 750-row import in three chunks plus
pruning. Heartbeats/chunks produce no extra source events and denied sessions
receive none. This is metadata coalescing, not a claim of zero backend work.
Final native CI at backend commit `efb01287` measured 480-byte response bodies
for three sources (20 calls, mean and maximum both 480) and 5.2 ms local p95.
That environment uses a fixture permission resolver; neither figure is a
production load or mobile-network benchmark.

Read-only production size diagnostics on September 8 found these uncompressed
JSON payload sizes: master 9,405 rows / 46,483,038 bytes; SOC 1,367 / 4,505,937;
active Request 3,258 / 7,528,138; reserves 4,888 / 16,675,952. These are database
serialization measurements, **not compressed network egress**. Full snapshots
remain substantial; transfer time is in addition to the 30-second reconciliation
bound. Ordinary healthy notifications target five seconds, but slow mobile links
can take longer to download a changed snapshot. No unlimited-user or Supabase
quota guarantee is implied. A future delta/staging design would be a separate
change; this release eliminates unchanged polling downloads and duplicate AV reads.

## Scope boundaries

- Root production AgMetric only. `/v2` and the BloomScapes storefront are unchanged.
- AgMetric's private BloomScapes pending-order dialog remains Dylan-only.
- Existing creation, assignment, completion, role and site rules remain in force.
- Two existing feature dependencies are not installed in production:
  `ph_production_workflow_rows` (propagation/planting) and
  `ph_inventory_transactions` (inventory transaction audit history). They remain
  explicitly unavailable, not silently aliased to unrelated data or created by
  this release. Installing those business workflows is separate work.

## Verification and rollout

Local executable tests cover revision races, unchanged row counts, deletion,
import interruption, stale account/permission/read scopes, hidden sessions,
coalescing, per-device filters and registry/adapter contracts. Production-built
browser tests use synthetic boundaries and block all business network writes.
The dedicated `live-dataset-revisions.yml` workflow uses disposable local Supabase
for actual native Auth, PostgreSQL transactions and Realtime subscriptions; a
PGlite run is supplemental SQL verification, not a substitute for that workflow.

Rollout order is additive database migration, fenced Apps Script importer, then
the versioned root PWA through the existing release process. Published-browser
verification must remain mutation-blocked. Do not create or complete customer
rows to test this repair. Record final test counts, deployment commit and measured
metadata traffic in the release verification report; no claim of successful
deployment follows from local tests alone.
