---
name: agdata-runtime-watchdog
description: Observe AgData runtime load stalls, rendered lockout banners and app-api failures without delaying authenticated views; review and resolve grouped incident reports in Manager.
---

# Runtime watchdog

`capture(error, operation)` observes caught operational failures in auth, sync, queue persistence and view lifecycles. It ignores expected AbortError cancellation and emits only an operation label plus bounded error code/name, never exception payloads or row contents. Fallbacks remain non-blocking. The telemetry transport's own terminal catch is deliberately excluded to prevent recursion; observers never rewrite source or publish releases.

The `GncRuntimeWatchdog` in `assets/runtime-watchdog.js` installs a passive MutationObserver and global error/rejection listeners. It records `VIEW_LOAD_STALL` for a visible loading marker that persists beyond 4,000 ms. After successful login, `assets/app-runtime.js` configures the sensor with the active username, role, and current Manager sub-tab, then sends through the authenticated app-api request helper. Failed sends remain in a bounded local queue partitioned by username; retries happen on connectivity recovery, foregrounding and backoff, and only the matching account can flush its queue. Account-generation fencing prevents a late response from an earlier account from changing another account's queue. Saving a refreshed app session token triggers another non-blocking flush. Telemetry must never block navigation, hydration, session continuity or drafts. Role aliases normalize to stable lowercase tokens. The watchdog currently detects sustained loading markers, recognized error banners and rejected app-api responses; parity-specific checks require an explicit source signal and must not infer an incident from a valid empty filter.

`DATA_PARITY_MISMATCH` observes explicit rendered source markers: active SUSPEND cards (`data-suspend-tag-card`) must not have `--` metric values (`data-queue-metric`), and visible Eval2 leaf `Loading...` text must clear within 2,000 ms. Cancel the Eval timer on completion, navigation or account-generation changes. Authoritative all-zero counts are an incident only when all 11 marked report counts contradict a positive published report-match count; valid empty reports and numeric zero/N/A metrics remain valid. The sensor records bounded diagnostic labels, never row contents. `request` is the actual Que view ID and maps to Cluster 4.

`app_runtime_watchdog_events` is service-role-only under RLS. `watchdog_log_event` binds username and role to the active server profile; `watchdog_list_events` and `watchdog_resolve_events` are restricted to Dylan, Megan and JD. The Manager panel is restricted to those same users. Keep event fields bounded and do not include row contents, credentials or user drafts. Fingerprints deduplicate by app version; status resolution is an operator action.

The Manager panel exposes the `COPY AI FIX BRIEF` action. `assets/runtime-watchdog-panel.js` owns the panel controller, shared incident reads, cached brief and view/account generations. `assets/app-runtime.js` retains the existing public render/refresh/copy handlers; `index.html` mounts their DOM and ordered scripts. Event persistence is in `supabase/functions/app-api/index.ts` and `supabase/migrations/*_runtime_watchdog_v1.sql`. Runtime anomalies map to existing module clusters and skills in [the dependency map](../../../docs/architecture/agdata-module-dependency-map.md). This does not replace domain ownership or the shared router: enter Manager through `setHomeTab` / `switchView`, retain `goBackUniversal`, `updateGlobalBackButton`, `viewHistoryStack`, and shared header/search ownership.

The panel script is optional for boot. If it fails to load or initialize, keep Manager and the rest of the app available through the runtime's no-op panel controller; telemetry capture during this fallback must also be guarded.

Focused checks:

Watchdog alert emails to Dylan include the complete Markdown AI FIX BRIEF. `supabase/functions/_shared/runtime-watchdog-brief.ts` formats both the signed alert payload and the authenticated list response; the in-app copy button copies that server response. Keep dataset revision/state metadata structured and preserve the existing hourly deduplication and fixed recipient.

Scoped Apps Script publication must include both signed watchdog helpers and the `runtime_watchdog_alert_v1` dispatch branch. The function patcher merges that branch into the live `doPost` while preserving other dispatch paths.

```sh
node --test tests/runtime-watchdog.test.mjs tests/role-access-parity.test.mjs
```

These static/VM contracts verify sensor fields and role aliases; they do not certify production alert delivery, rendered parity, database latency or all device profiles. Email alerts are sent only through an authorized deduplicated production delivery path.

Panel badge and incident-list refreshes share one pending read for the same verified account. A changed view, auth epoch or mounted host must reject stale completion; account changes clear private cached brief/events before reuse. Resolving an incident keeps the existing server authorization and must not repaint an unmounted panel.

The top-header count badge is exclusively for canonical `dylan_collyge`. Start it with both `hidden` and `display:none`, force-hide/clear it on other accounts and logout, and reject late badge reads from an earlier owner. Add `WATCHDOG MONITOR` as the first Manager module for Dylan, Megan and JD, preserving its existing panel authorization. This visibility restriction does not disable background event logging or change the existing Manager review authorization. App-api event persistence uses its service-role client. When changing watchdog SQL, register each migration in `scripts/apply-item-low-stock-migration.mjs` with an installed-contract check.

Manager render regression coverage includes inactive Home renders and cold paged Eval2 initialization; watchdog observations remain passive and do not authorize remediation.
