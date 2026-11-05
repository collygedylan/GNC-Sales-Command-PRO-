---
name: test-agdata-runtime-watchdog
description: Observe AgData runtime load stalls, rendered lockout banners and app-api failures without delaying authenticated views; review and resolve grouped incident reports in Manager.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Runtime watchdog

`capture(error, operation)` observes caught operational failures in auth, sync, queue persistence and view lifecycles. It ignores expected AbortError cancellation and emits only an operation label plus bounded error code/name, never exception payloads or row contents. Fallbacks remain non-blocking. The telemetry transport's own terminal catch is deliberately excluded to prevent recursion; observers never rewrite source or publish releases.

The `GncRuntimeWatchdog` in `test/assets/runtime-watchdog.js` installs a passive MutationObserver and global error/rejection listeners. It records `VIEW_LOAD_STALL` for a visible loading marker that persists beyond 4,000 ms. After successful login, `test/assets/app-runtime.js` configures the sensor with the active username, role, and current Manager sub-tab, then sends through the authenticated app-api request helper. Failed sends remain in a bounded local queue partitioned by username; retries happen on connectivity recovery, foregrounding and backoff, and only the matching account can flush its queue. Account-generation fencing prevents a late response from an earlier account from changing another account's queue. Saving a refreshed app session token triggers another non-blocking flush. Telemetry must never block navigation, hydration, session continuity or drafts. Role aliases normalize to stable lowercase tokens. The watchdog currently detects sustained loading markers, recognized error banners and rejected app-api responses; parity-specific checks require an explicit source signal and must not infer an incident from a valid empty filter.

`DATA_PARITY_MISMATCH` observes explicit rendered source markers: active SUSPEND cards (`data-suspend-tag-card`) must not have `--` metric values (`data-queue-metric`), and visible Eval2 leaf `Loading...` text must clear within 2,000 ms. Cancel the Eval timer on completion, navigation or account-generation changes. Authoritative all-zero counts are an incident only when all 11 marked report counts contradict a positive published report-match count; valid empty reports and numeric zero/N/A metrics remain valid. The sensor records bounded diagnostic labels, never row contents. `request` is the actual Que view ID and maps to Cluster 4.

`test_app_runtime_watchdog_events` is service-role-only under RLS. `watchdog_log_event` binds username and role to the active server profile; `watchdog_list_events` and `watchdog_resolve_events` are restricted to Dylan, Megan and JD. The Manager panel is restricted to those same users. Keep event fields bounded and do not include row contents, credentials or user drafts. Fingerprints deduplicate by app version; status resolution is an operator action.

The Manager panel exposes the `COPY AI FIX BRIEF` action. `test/assets/runtime-watchdog-panel.js` owns the panel controller, shared incident reads, cached brief and view/account generations. `test/assets/app-runtime.js` retains the existing public render/refresh/copy handlers; `test/index.html` mounts their DOM and ordered scripts. Event persistence is in `test/supabase/functions/app-api/index.ts` and `test/supabase/migrations/*_runtime_watchdog_v1.sql`. Runtime anomalies map to existing module clusters and skills in [the dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md). This does not replace domain ownership or the shared router: enter Manager through `setHomeTab` / `switchView`, retain `goBackUniversal`, `updateGlobalBackButton`, `viewHistoryStack`, and shared header/search ownership.

The panel script is optional for boot. If it fails to load or initialize, keep Manager and the rest of the app available through the runtime's no-op panel controller; telemetry capture during this fallback must also be guarded.

Focused checks:

Watchdog alert emails to Dylan include the complete Markdown AI FIX BRIEF. `test/supabase/functions/_shared/runtime-watchdog-brief.ts` formats both the signed alert payload and the authenticated list response; the in-app copy button copies that server response. Keep dataset revision/state metadata structured and preserve the existing hourly deduplication and fixed recipient.

Scoped Apps Script publication must include both signed watchdog helpers and the `runtime_watchdog_alert_v1` dispatch branch. The function patcher merges that branch into the live `doPost` while preserving other dispatch paths.

```sh
node --test test/tests/runtime-watchdog.test.mjs test/tests/role-access-parity.test.mjs
```

These static/VM contracts verify sensor fields and role aliases; they do not certify production alert delivery, rendered parity, database latency or all device test_profiles. Email alerts are sent only through an authorized deduplicated production delivery path.

Panel badge and incident-list refreshes share one pending read for the same verified account. A changed view, auth epoch or mounted host must reject stale completion; account changes clear private cached brief/events before reuse. Resolving an incident keeps the existing server authorization and must not repaint an unmounted panel.

The top-header count badge is exclusively for canonical `dylan_collyge`. Start it with both `hidden` and `display:none`, force-hide/clear it on other accounts and logout, and reject late badge reads from an earlier owner. Add `WATCHDOG MONITOR` as the first Manager module for Dylan, Megan and JD, preserving its existing panel authorization. This visibility restriction does not disable background event logging or change the existing Manager review authorization. App-api event persistence uses its service-role client. When changing watchdog SQL, register each migration in `test/scripts/apply-item-low-stock-migration.mjs` with an installed-contract check.

Manager render regression coverage includes inactive Home renders and cold paged Eval2 initialization; watchdog observations remain passive and do not authorize remediation.

## Request completion and foreground continuity

Request permission refresh and sync progress retain same-account views. manual_sync_status is an exact read-only app-api fixture action and may be classified as a canceled read; request_work/capabilities is read-only while request_work/save remains a mutation. The watchdog remains passive and does not gain request-write or deployment authority.

Watchdog delivery pauses while document.hidden; its bounded persisted queue resumes once visible without deleting pending incidents. It remains a passive observer.

Benign browser `ResizeObserver loop limit exceeded` and `ResizeObserver loop completed with undelivered notifications` messages are ignored; they are layout scheduling noise, not actionable runtime incidents.

## Watchdog and active queue continuity

Manager WATCHDOG MONITOR routes through setHomeTab(runtime-watchdog), renders without the generic Manager dataset gate, and returns through goBackUniversal/openManagersModules. Keep data-manager-module="watchdog-monitor" on its card; keep the existing three-user panel boundary, list/parity/Copy AI Fix Brief/Resolve contracts, and read-only production watchdog policy.

## Owned Files, Canonical Functions & SQL Contracts

- `test/assets/runtime-watchdog.js`: `record`, `capture`, `inspectDataParity`, `OWNERS`; `test/assets/runtime-watchdog-panel.js`: incident list/fix brief controller; app-api watchdog event actions and service-role SQL RPCs.
- Every emitted `owning_skill` and `suspected_functions` entry must resolve through `test/docs/architecture/test-agdata-symbol-index.json`; events report the current app release version.

## Cross-Layer Blast Radius

- Incident view/cluster mapping crosses rendered DOM evidence, bounded local queue, authenticated app-api persistence, Manager review, fix-brief text, skill ownership, and canonical symbols. A release-version change discards prior-version queued incidents as resolved historical noise.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `test/workers/email/Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `test_ph_app_users` and `test_user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.165. A completed-row 42501 requires a deliberate unlock through the authenticated exact-row SQL RPC. Preserve drafts and keep server denials visible. Reclass may recover an uncertain command only from its actor-scoped receipt under the original token. Background reads retain verified same-account data. Watchdog repairs footer position and recounts badges before reporting persistent anomalies. Operational auto-resolution records a telemetry disposition, never a save receipt. Invariant 459 protects this boundary.

- v2.3.164, Invariant 457. A Drive footer pinned at bottom zero is anchored to the layout viewport. A shifted mobile visual viewport must not generate FOOTER_OFFSCREEN. Retain monitoring for displaced, unpinned footers.
- v2.3.130: Never leave transformed photo URLs in cache keys, poll closed/hidden background UI, persist routine watchdog diagnostics, or emit success Edge logs. Keep signed cloud relays independent of the browser, protect referenced receipts and private grants, and verify empty CLI receipts against installed contracts (Invariants 323–326).

- v2.3.112: Never retain raw exception text, stack traces, payloads or arbitrary metadata in handled diagnostics. reportHandledRuntimeIssue accepts allowlisted static scopes/codes only, bounds immutable ring entries to 100, and uses the existing transport; intentional capability probes use safeIgnoreProbeError. Observer failure is terminal and cannot block the app.

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never emit an unknown skill/symbol, retain prior-version incidents in the active queue, include row contents/credentials/drafts, block a view, or let watchdog/AI write production data, source, commits, or deployments.
- Never infer a parity incident from an authorized empty result or turn telemetry transport failure into recursive reporting.
- Never record navigation/scope cancellation codes as operational failures or hardcode an old release in the active Watchdog fix brief.
- Never resolve a load-stall cluster by suppressing telemetry alone; prove the owned view renders retained rows before background hydration, then close the exact incident cohort with its release version.
- Never return a transient `503` for an authorized customer mapping read when a retained directory can stay visible with `200`, and never carry verified resolved incidents into the next active release version.
