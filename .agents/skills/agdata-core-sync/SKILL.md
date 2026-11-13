---
name: agdata-core-sync
description: Maintain AgData authentication, cache-first boot, five-stage live sync, Supabase data access, quota controls, and database hygiene. Use for src/core changes or cross-layer sync/read-continuity work; do not use for DOM presentation or release publication alone.
---

# AgData Core Sync

Own src/core and the state/read side of the live Supabase project
kzrnyjsosryejjejliii. Read the repository AGENTS.md, latest state, symbol index,
and relevant source skill before changing behavior.

## Decisions this skill owns

- Native-auth identity, account/permission epochs, stale-while-revalidate
  caches, bounded snapshot hydration, and fail-open same-account reads.
- DRIVE, CAV, RESERVES, SOC, and HL PO stage state, resumable publication,
  revision signals, and protected READY/LKG data.
- Supabase read contracts, quota/egress controls, retention helpers,
  autovacuum/index evidence, and bounded database maintenance.
- Capability and access matrices as server-authoritative state. UI visibility
  never grants mutation authority.

## Invariants

- Use only project kzrnyjsosryejjejliii. Never revive the retired sandbox.
- An import, permission refresh, or transient failure cannot blank an
  authenticated view or discard same-account data.
- Browser reads, Apps Script, app-api, and Postgres functions/triggers retain
  their independent authorization and performance boundaries.
- Database tuning is evidence-led. Inspect installed pg_catalog state first;
  use online operations, bounded timeouts, and tracked migrations. Preserve
  business, inventory, weather/GDD, evaluation, receipt, and photo history.
- src/core modules stay below 400 physical lines; changed functions stay at or
  below 60 lines with nesting no deeper than three.

## Forbidden Anti-Patterns (Never Repeat)

- Do not spend the read-probe deadline on photo binaries or use editor navigation to cancel accepted photo jobs. Keep capture-order transfers, bounded transient retries, account-owned IndexedDB backup, and publication through exact-row receipts. Request archive must preserve the authority to finish accepted evidence.
- Do not infer archived Request photo authority from the archive or a public URL. Register the capture IDs atomically with completion, verify the native actor and physical row, bind each ID to the validated immutable Storage object, and keep its folder completion email pending until the final exact receipt or the bounded delivery deadline.
- Never evaluate whole-row JSON or resolve the interactive actor before an existing authenticated bulk-return guard. Audit DECLARE initializers as well as the function body; preserve the protected blank-overwrite and completion-sync definitions exactly. Validate exact/mismatched evaluation UIDs and real interactive evidence capture in the local PostgreSQL fixture.
- Do not scan wide statement transition tables to discover an unchanged Drive
  evidence tuple. Guard the statement with an exact row-delta marker and retain
  SOC lot, priority, and ambiguity checks for actual changes. Compare effective
  SOC values before writing so retained Dock fields and Suspend dates do not
  create duplicate Sales capture work. Validate sealed
  Item6 key sets once and use typed assignment and stock projections while
  keeping live override ledger reads, writes, and acknowledgments fenced.
  Verify the installed definitions before accepting an apply or replay receipt
  (Invariant 610).
- Crop Roll is retired from AgData. Preserve its stored history and keep both
  interactive writes and RUN SCRIPT disconnected from its projection triggers.
  Do not accumulate projection-only UID arrays during canonical inventory writes.
- Resolve missing-source Drive rows before applying retention guards. Carry the
  same statement's physical tuple witness into the delete so an intervening edit
  is never treated as the earlier eligible row.
- Do not rescan the full staged identity map for every pending override field.
  Acknowledge only exact raw values against the current ledger row and apply
  one typed patch per exact physical row. Keep the pre-overlay stock witness
  and season-stock reconciliation inside the same transaction (Invariant 610).
- Do not take one advisory lock per physical row in the native Drive assignment
  publication. Hold the shared assignment transaction gate before the import
  fence and preserve the set-based write and interactive exact-row locks
  (Invariant 610).
- Skip speculative default-owner inserts when the default already exists.
  Stamp revision-only assignment rows without firing the itemcode trigger.
  Keep plant-group changes, genuine audit entries, and READY revisions on
  their existing owners (Invariant 610).
- Do not invoke the generic scheduled handover on blank ERP RESERVES or SOC assignments.
  Guard the exact NEW assignment lanes and retain real handovers, clears,
  completed rows, and their audit behavior (Invariant 613).
- Do not pass an unqualified table alias to JSON conversion when an ERP column
  shares its name. Qualify the whole RESERVES and SOC source row, including a
  null or populated Source field, before enqueueing exact history (Invariant 614).
- Never leave inherited photo-evidence lookups without their exact item/location
  indexes. Preserve the protected publication trigger definitions and verify the
  installed index expressions instead of weakening evaluation safeguards
  (Invariant 610).
- Freeze Drive archive evidence as typed records with the publication receipt.
  Keep new snapshots in durable batches of at most 500 typed rows and preserve
  the legacy queued snapshot reader until those jobs drain.
  Run the existing archive and projection proof in one bounded background job
  against that immutable snapshot. A queued archive does not count as processed
  (Invariant 610).

- Never flood the browser request queue while installing a worker. Deduplicate
  assets, cap concurrent downloads and write the receipt only after every
  required asset is present. Preserve the independent 1.2 s navigation deadline
  (Invariant 607).
- Never preload the joined PO report from Home or other unrelated views. Use
  `hl_po_parsed` publication metadata for Home and reserve the report read for
  the PO Management surface or an explicit HL PO import refresh (Invariant 606).
- Do not stamp every retained physical row just to advance a workbook filename.
  Keep unchanged rows unchanged; the source publication receipt owns file freshness.
- Do not run full SOC history or location-evidence refreshes inside a Drive
  publication transaction. Preserve exact deferred work and bound its retries.
  Scope the same rule to SOC rows changed by ERP photo reconciliation. Freeze
  those rows before the next workbook can replace them and keep interactive
  history capture synchronous (Invariant 610).

- Do not put a live refresh behind verified disk replay or wait for the
  network before showing the same authorized snapshot. Keep each completion
  fenced to the current account and permissions.
- Do not restart automatic Drive publication after retry exhaustion without
  evidence that the final swap can finish. Keep the prepared stage and last
  READY snapshot separate, and verify any scheduler pause with a fresh read.

- Never put a matching verified sign-in behind a network credential request.
  Keep an unverified account behind the authoritative sign-in boundary.

- Never register an update using the running shell's versioned worker URL or
  treat an HTTP 200 with stale HTML as a completed install. Verify the target
  release marker before activation and preserve the installed shell when the
  update navigation reaches a stale origin response.

## Working boundary

Keep core modules free of DOM rendering and raw UI event handling. Publish
explicit state and receipts for src/views and src/ui consumers. Delegate
canonical row/evaluation math to agdata-canonical-engine and external
transport/publication work to agdata-services-release.

## Verification

Choose focused tests from live-sync-coordinator, live-sync-registry-coverage,
master-snapshot-chunk-import, security-zero-trust, Supabase quota security,
and the affected auth/cache tests. SQL changes require installed-state
inspection plus an isolated or rolled-back behavioral check.

## Forbidden Anti-Patterns (Never Repeat)

- Never evaluate whole-row JSON or resolve the interactive actor before an existing authenticated bulk-return guard. Audit DECLARE initializers as well as the function body; preserve the protected blank-overwrite and completion-sync definitions exactly. Validate exact/mismatched evaluation UIDs and real interactive evidence capture in the local PostgreSQL fixture.

- Never replace an active ERP run to clear a stalled scan. Bound discovery, reclaim the
  saved cursor after 25 seconds of scanning or 90 seconds without source progress,
  and fence expired workers out of checkpoint writes (Invariant 601).

- Never recount a sealed ERP stage before reading its payload or toggle master
  inventory triggers during publication. Use the append count, verify the read
  payload, and keep retries attached to the same publication receipt (Invariant 599).
- Never build ordinal aliases for already matched identities or serialize a
  whole live row to compare lineage. Native publication must use its own
  application name so scheduled maintenance can yield without skipping the
  publisher's inline location-evidence reconciliation.

- Keep continuation single-flight per account and run. A late response from a superseded run cannot repaint the current modal. Prove Drive projection identity with a set difference instead of re-scanning staged history per inventory row (Invariant 592).

- Never let an event-driven coordinator freeze after one discarded inventory page or background revision failure, and never signal a new background run while the failed run still owns its finalizer. Retain the same-account preview, then use independent owner-fenced, bounded recovery lanes until the complete master and dependent assignments publish or a terminal authorization/projection error is proven (Invariant 547).
- Never let a 200/1,000-row preview replace a verified complete master or count as full hydration. Preserve the complete same-account rows, retry revision-consistent field coverage, and force the existing canonical full loader when a preview remains partial after coordinator recovery (Invariant 548).
- Never make the canonical physical-row merger depend on a caller-supplied photo parser; its extracted photo-domain default must merge duplicate item/location/lot evidence during complete Drive/AV hydration instead of throwing (Invariant 549).
- Never advertise a progressive preview adapter that is absent from the active foreground cohort; derive preview IDs from the actual adapters so Home metadata-only refreshes cannot invalidate Drive/Suspend hydration (Invariant 550).
- Never collapse canonical `fullInventory` rows by item/location/lot while rebuilding indexes; retain every physical UID and merge only explicit card display projections (Invariant 551).
- Never dereference the live-sync coordinator from deferred Drive Common Name batching before it exists; keep batching in the extracted lifecycle-fenced owner and render freshness only from a captured status (Invariant 552).
- Never dereference the mutable coordinator global when a staged production refresh settles; obtain the current coordinator once and skip freshness rendering when session boot has not created it (Invariant 553).
- Never restore the raw exact-row card shortcut after canonical inventory stops collapsing physical rows; card presentation must derive exact-lot quantities and item/location aggregates from the complete uncollapsed snapshot without mutating canonical rows (Invariant 554).
- Never deduplicate historical snapshots by a global hash or by comparing only retained rows. Record every completed file, including an empty snapshot, as a coverage barrier; compare only consecutive states so `A -> B -> A`, disappearance, and reappearance remain visible, and preserve each browser/service caller's existing RLS-safe grants when readers move behind compatibility views (Invariant 563).
- Never leave a Smart Hold reader on a physical compacted-history response or a single PostgREST page. Route browser observation GETs through the read-only logical-view alias, route app-api GETs through its global read-only snapshot transport, exhaust the bounded 1,000+500 browser pages with a stable unique-ID tie breaker, and keep the live-sync registry on the physical table's registered revision identity (Invariant 567).
- Never reconstruct a compacted observation from a mutable retained physical row or infer file completion from status alone. Own business state in an immutable digest pool, keep per-observation provenance separately, require exact count/date/completion receipts for the current and predecessor files, and preserve logical rows across retained-row updates, deletes, Hold rebuilds, and replay. Keep the bounded scheduler inactive until every physical reader is compatibility-routed (Invariant 570).

The complete 21-to-5 migration and cross-layer checklist is in
docs/gemini-clean-gems-blueprint.md.

### v3.0.64 manual ERP restart and publication

Cross-layer blast radius: browser commands delegate to the authenticated app-api start owner; SQL alone decides whether a stale scan can be superseded. Existing Code.gs token delivery, canonical import/evaluation owners, protected triggers and assignment resolvers remain authoritative. The Home metadata command awaits the existing revision RPC under its original account scope.

## Forbidden Anti-Patterns (Never Repeat)

- Never discard a validated manual restart flag at the Edge handler, reset a sealed publication checkpoint, or treat a coordinator wake as a completed Home metadata read. Invariant 616 exercises restart forwarding, healthy-run retention, late-account rejection and prepared-versus-published receipts.
- Keep Edge imports inside supabase/functions. Prepare durable ERP publication parts in bounded batches, validate replay content, and move source files only after the canonical atomic publication receipt.
