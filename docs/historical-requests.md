# Historical Requests and pipeline values

Historical Requests is a primary, read-only view. It is separate from the existing
Request History operational workflow. The customer → consignee → request hierarchy
uses server pages, with an account-scoped, memory-only SWR cache. The component and
its stylesheet load on entry; public chunks are included in release precaching.
No request rows or financial responses are stored in the service worker.

## Authorization

`historical_requests_read_v1` accepts a native Supabase user JWT. PostgreSQL binds
the actor to `auth.uid()` and rechecks the stored profile. REP and SALESREP users
see only requests assigned to their authenticated profile UUID. Creator identity
does not grant access. The exact stored username `dylan_collyge` and explicit
ADMIN/ADMINISTRATOR roles may read all requests and the rep leaderboard. Other
Managers do not receive that override. Disabled, locked, password-change-required,
anonymous and ineligible accounts are denied. Existing operational policies and
history endpoints retain their current behavior.

## Values and source identity

- History wins when the same request identity also exists in the active queue.
- Price comes from current master inventory using its exact unique ID first. When
  that ID has no current match, the complete item-code, size, location, and lot
  tuple supplies one price only when all matching rows have the same valid price.
  Incomplete tuples, conflicting prices, and invalid prices remain unresolved.
  Historical request rows are never rewritten by this lookup.
- Value is `COALESCE(NULLIF(request_qty, 0), 25) * listprice`.
- Blank/missing quantity has the same 25 fallback. Malformed quantities, missing
  inventory identities and unavailable prices are reported as unresolved; they
  are excluded from known dollar totals.
- Values describe the request pipeline at **current** prices. They are not booked
  revenue, historical price snapshots or a promise of fulfillment.
- Customer/consignee keys retain external identity IDs, keeping identical names
  distinct. Groups, totals and unresolved counts are calculated after access
  filtering, with bounded pages and deterministic ordering.

Account/role changes and logout destroy mounted financial data. Focus, reconnect,
and visible polling revalidate the RPC. Read failures hide stale results and
provide a retry action. No mutations are exposed by this module.

The temporary performance timing allowance remains governed by
`performance/baseline.json` and its planned Prompt 7 restoration; this feature
does not reset measured baselines or change the release gates.
