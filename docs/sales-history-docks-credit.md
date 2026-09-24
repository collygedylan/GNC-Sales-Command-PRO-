# Sales request history and permanent Docks credit history

This additive release extends the current app. It is not the separate Windows-server migration.

## User workflow

Sales → Request History opens on All and includes requests assigned to the rep plus requests that rep personally created. Creator and assigned rep remain separate. Search runs on the complete permitted history before pagination and covers customer, consignee, common name, item code, and folder. Missing historical information is shown explicitly.

Sales → Credit opens on Docks History. Completed Requests remains a separate source tab. Request Credit on an active Docks row or eligible completed history row resolves the exact saved source on the server. Credit ownership is narrower than creator-only history visibility. Existing reviewers remain Dylan Collyge, JD Jones, and Megan Kelly.

Drafts, multiple affected lines, optional camera/gallery photos, uncertain-submission identities, and reviewer revision checks use the existing protected workflow. Saved evidence remains private and retained with its claim.

## Database and compatibility

- Apply `20260924115226_sales_history_customer_docks_ownership.sql` before deploying the updated `app-api` and frontend.
- **Existing production already applied the history migration. Do not reapply it or use an unreviewed bulk database push.** The production migration registry uses version `20260924144455` for that file. The two emergency pause files map respectively to production versions `20260924145512` and `20260924150222`; retain this mapping when reconciling deployment history.
- The history migration now installs the metadata-notification guard before its backfill for fresh installations. Existing upgraded production receives only `20260924155225_request_metadata_notification_guard.sql`, which replaces the trigger function without touching requests or notification rows. It does **not** restart sending.
- After exact-candidate validation and a read-only review of all held events, apply `20260924155542_restore_request_delivery_after_metadata_guard.sql` to restore the original worker privilege, two wake triggers, and scheduler. This requires the guard and no in-flight events; it never changes event status or retries delivered/failed/unknown/suppressed history. Never restore any historical notification from a backup.
- `ph_credit_sources` remains the permanent table; `sales_private.source_versions` retains changes. Capture survives active-row removal and invoice/import updates. Recovery reads retained `ph_soc_master` rows without a date cutoff and is repeatable.
- Exact normalized account aliases and verified imported external IDs resolve rep ownership. Ambiguous or unknown identities stay unassigned. Import/profile changes refresh mappings and repair missing owners without reassigning established history. Incomplete or interrupted rep-map imports cannot assign external-ID ownership; successful publication repairs waiting records after every batch has been considered.
- New optional request fields: `customeridentityid`, `customername`, `consigneeidentityid`, `consigneename`. Same-request snapshots can restore missing information; names never establish IDs. Legacy clients remain accepted.
- Credit folders/sources accept optional `sourceKind`. `source` requires `sourceKind` plus exact `sourceUniqueId`, returning `{source,folder}`. It cannot create a source and applies module/ownership checks, including canonical sources.
- `sales_history_unresolved_sources_v1()` is a service-only review report. Do not expose its results to reps.

Previously deleted shipments without retained source evidence cannot be reconstructed. Do not replace business data with old backups or infer ownership from approximate names.

## Verification and release evidence

Focused SQL fixtures cover real imported names, future reps, ambiguity, immutable ownership, invoiced recovery, repeated capture, exact source access denial, creator visibility, context preservation, full search and pagination. Native isolated CI additionally runs the existing append, private photo, duplicate claim, and concurrent-review suites.

The notification regression seeds a previously completed historical folder with a delivered creation event but no V2 completion state **before** the history migration. It runs the real active-row, legacy-completion, and outbox triggers and asserts that the full backfill creates no completion event or folder delivery state. Metadata, photos, row versions, no-op writes, status synonyms and completion-date corrections remain silent. Genuine completion, late append coverage, folder moves, archive/unarchive and deletion still reconcile. The initial isolated run reproduced the production fanout before the guard. This fixture must never be deployed to production.

The import regression reproduces a unique-looking first batch followed by a conflicting second batch, interrupted imports, and successful retries. It verifies unchanged historical owners, preserved import-token enforcement, and no new claims or notifications during repair. Source writers and import publication take the mapping-revision lock before business-row locks, while read APIs remain lock-free. Eight native independent-connection tests cover overlapping Docks/history capture and mixed-dataset import begin/finish. Mixed imports retain their existing payload and sorted-key contracts. The native concurrency fixture imports rep mappings through the same automatic identity path instead of manually duplicating generated aliases.

Compiled browser fixtures cover desktop, Android, iPhone, narrow phones, source tabs, Back navigation, active Docks entry, multi-line/photo drafts, failed uploads, lost acknowledgements, and review decisions. The protected complete candidate and hosted validation gates remain mandatory.

Read-only preflight on 2026-09-24: 3,040 saved Docks sources, zero assigned; 3,639 request-history rows, 3,356 assigned; 331 retained active SOC rows. Record after-deployment counts and exact release proof in the private release report. This source document is not evidence that publication has completed.

Independent review identified creator-only history access, completed-source lookup, and credit-button eligibility gaps; the implementation and regression tests address them. Local fixture corrections accounted for background live refresh and normal Docks rep/date/drill-down requirements rather than bypassing those behaviors.

The fixture installs specialized API routes before navigation, after its catch-all route. Local WebKit bootstrap errors were traced to an incomplete test artifact: the new shell had an old manifest/fingerprint, triggering a startup reload. Replacing it with the complete fresh foundation package fixed the formerly failing history test. Never refresh only the shell after changing the release marker. Strict browser error assertions remain enabled.
