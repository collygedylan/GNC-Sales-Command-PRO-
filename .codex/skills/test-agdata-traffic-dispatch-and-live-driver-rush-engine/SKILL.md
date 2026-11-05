---
name: test-agdata-traffic-dispatch-and-live-driver-rush-engine
description: "Maintain test Traffic check-in, live-driver rush priority, shipped quantities and manifest export."
---

# traffic dispatch and live driver rush engine

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.

## Traffic and live-driver priority
Own #view-traffic with Check-In and Completed Orders. Record the real driver/trailer arrival time, load and dock association; distinguish drop trailers from live drivers. A live-driver INSERT and false-to-true UPDATE must elevate every associated open test SOC pull line to is_rush_priority=true. New lines added to a checked-in live-driver load inherit rush status. Rank these lines before spatial routing and show accessible pulsing red priority with reduced-motion support.
The <3-hour turnaround is an operational target, not a performance claim from automated tests. Compute dwell from recorded arrivals and dispatches; never fabricate an eight-hour baseline or a successful target.

## Shipment and completion
Store shipped_qty as a nonnegative integer per exact line, bounded by remaining eligible verified quantity and ordered_qty. Render both the integer column and Shipped / Ordered fraction. Pink-tape material cannot contribute to shipped quantity. Dispatch requires inspector signature, TRAILER_LOADED evidence and the expected trailer seal; retain the authenticated driver acknowledgement timestamp. Completed Orders shows only receipt-confirmed completion.

## Manifest PDF
Generate a real downloadable PDF from the exact committed shipment snapshot. Include load/drop, ordered/shipped line quantities, destinations, driver signoff timestamp, inspector badge and trailer seal. A browser print dialog alone is not a PDF export receipt. Never use provider/email production routes for test exports. Preserve shared Back navigation and draft continuity.

## Verification
Exercise live-driver INSERT and UPDATE, late SOC inserts, drop-trailer non-rush behavior, stable rush sorting, shipped bounds, pink-tape rejection, premature dispatch denial, immutable completed receipts and readable PDF content.

## Cross-layer blast radius
Changes are confined to test frontend modules, test-only Edge/server commands, public.test_* RPCs/tables and test_* private schemas. The isolated Apps Script sender delivers only signed new test events to Dylan. Production Code.gs, SQL/RPCs, app-api, runtime and delivery workers are read-only donors and remain unchanged. Shared test Back/navigation and server authorization stay canonical.

## Forbidden Anti-Patterns (Never Repeat)
- Never treat a client-only guard, a renamed table, a copied trigger, or an HTTP success as proof of isolation or a committed operation.
- Never promote test code/data, execute copied production jobs, reuse live secrets or broaden production grants automatically.
- Append a behavior-based regression test and the root cause here when fixing this domain; do not weaken prior contracts.
