# Request History and executive reporting

Request History and Historical Requests share a read-only React view: Sales Rep →
mapped Customer/Consignee folder → request cards. Reps default to their own profile
and cannot query another rep. Exact external customer/consignee IDs preserve
leading zeros and distinguish duplicate names. Existing legacy records remain readable.

## Financial authorization

Only the active `dylan_collyge` admin and explicitly designated active financial
admins can see all reps or dollar values. Other Admin roles receive own scope.
The private `request_financial_admins_v1` allowlist is inaccessible to clients;
this release designates no additional accounts. Disabled, locked, password-change
and scheduled account restrictions remain enforced. Request and historical table
policies enforce ownership; raw historical snapshots are unavailable to clients.
Legacy history APIs redact monetary fields recursively. Credit permissions remain
separate. AURA receives the same redacted data and invalidates old pricing responses.

## Catalog pricing and incoming values

Price comes from the active catalog by exact textual `itemcode` only. Lot, location,
size, sales year and stale inventory row IDs do not select the price. Repeated
catalog rows with the same valid price share one base price. Missing or conflicting
base prices remain unknown. Existing request rules retain 25 units for blank or
zero quantity; negative or malformed quantities remain unresolved for review.

Database triggers calculate incoming request values in private storage immediately.
Reports calculate values against the current catalog on every read, including legacy
requests. Historical source rows are not rewritten to repair their pricing. These
are current-price pipeline values, not booked revenue or a historical selling price.

## Orders and reporting

Requests have a NULL dock. Orders have any non-NULL dock, including `0` or an empty
string. Current active dock assignments and archived snapshot dock values are
supported. Photos, requested specs, notes, sent date and delivery state remain visible.

The executive reporting panel provides specific-month, date-range, year-to-date and
all-date selections; rep/customer filters; and aggregate, monthly, rep and customer
totals. Chicago calendar boundaries define each date, including the entire through
date and daylight-saving changes. Missing dates are excluded from bounded periods.
Directories and grouped results paginate fully on the server after authorization.

Account/role changes, navigation and logout clear private mounted caches. Read
failures and scope downgrades hide cached results. No financial responses are stored
in the service worker. Source revisions fence each response and revalidate on focus,
reconnect and polling. Full local database and regression suites precede publication.
