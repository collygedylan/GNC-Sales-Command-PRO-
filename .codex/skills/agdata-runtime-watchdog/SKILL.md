---
name: agdata-runtime-watchdog
description: Observe AgData runtime load stalls, rendered lockout banners and app-api failures without delaying authenticated views; review and resolve grouped incident reports in Manager.
---

# Runtime watchdog

`capture(error, operation)` observes caught operational failures in auth, sync, queue persistence and view lifecycles. It ignores expected AbortError cancellation and emits only an operation label plus bounded error code/name, never exception payloads or row contents. Fallbacks remain non-blocking. The telemetry transport's own terminal catch is deliberately excluded to prevent recursion; observers never rewrite source or publish releases.

The `GncRuntimeWatchdog` in `assets/runtime-watchdog.js` installs a passive MutationObserver and global error/rejection listeners. It records `VIEW_LOAD_STALL` for a visible loading marker that persists beyond 4,000 ms. Telemetry is sent through the authenticated app-api request helper, is best effort, and must never block navigation, hydration, session continuity or drafts. Role aliases normalize to stable lowercase tokens. The watchdog currently detects sustained loading markers, recognized error banners and rejected app-api responses; parity-specific checks require an explicit source signal and must not infer an incident from a valid empty filter.

`app_runtime_watchdog_events` is service-role-only under RLS. `watchdog_log_event` binds username and role to the active server profile; `watchdog_list_events` and `watchdog_resolve_events` are restricted to Dylan, Megan and JD. The Manager panel is restricted to those same users. Keep event fields bounded and do not include row contents, credentials or user drafts. Fingerprints deduplicate by app version; status resolution is an operator action.

The Manager panel exposes the `COPY AI FIX BRIEF` action. The panel and client sensor are hosted by `index.html`; event persistence is in `supabase/functions/app-api/index.ts` and `supabase/migrations/*_runtime_watchdog_v1.sql`. Runtime anomalies map to existing module clusters and skills in [the dependency map](../../../docs/architecture/agdata-module-dependency-map.md). This does not replace domain ownership or the shared router: enter Manager through `setHomeTab` / `switchView`, retain `goBackUniversal`, `updateGlobalBackButton`, `viewHistoryStack`, and shared header/search ownership.

Focused checks:

Watchdog alert emails to Dylan include the complete Markdown AI FIX BRIEF. `supabase/functions/_shared/runtime-watchdog-brief.ts` formats both the signed alert payload and the authenticated list response; the in-app copy button copies that server response. Keep dataset revision/state metadata structured and preserve the existing hourly deduplication and fixed recipient.

Scoped Apps Script publication must include both signed watchdog helpers and the `runtime_watchdog_alert_v1` dispatch branch. The function patcher merges that branch into the live `doPost` while preserving other dispatch paths.

```sh
node --test tests/runtime-watchdog.test.mjs tests/role-access-parity.test.mjs
```

These static/VM contracts verify sensor fields and role aliases; they do not certify production alert delivery, rendered parity, database latency or all device profiles. Email alerts are sent only through an authorized deduplicated production delivery path.
