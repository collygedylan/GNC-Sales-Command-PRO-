# Hybrid inventory assignments

## Authority

`ph_itemcode_default_owners` stores one persistent default for each normalized
Itemcode. `ph_inventory_row_assignments` stores the effective owner of each
current `ph_master_inventory.unique_id`. Neither table changes the master
inventory's operational `assignedto` field.

| Source row | Effective owner |
| --- | --- |
| C.06/C.07, D.04–D.09, or D.10.000–D.10.021; `135_ROSES` | `mitch_kaiser` |
| Same locations, other plant groups | `zoe_green` |
| Valid outside location | Active Itemcode Default Owner, otherwise unassigned |
| Unresolved location, including bare D.10 | Last confirmed row owner, with review flag; new rows unassigned |

The existing strict location parser normalizes case and whitespace. D.10.022
is outside. Plant group matching uses `plantgroupcode` case-insensitively.
An active assignment-roster member can own work before native account
provisioning; a known disabled or locked account cannot receive new ownership.
Every interactive command still requires a valid active authenticated session.

## Editing and existing work

Assigned Items displays each source row and one **Itemcode Default Owner**
control per displayed Itemcode. Dylan and Megan retain editing access. Default
changes use expected revisions and request IDs. Effective ownership is derived
and read-only. Errors retain the selected value; Refresh retrieves the current
revision before a reviewed retry. A default change does not notify workers.

Current saved assignments supply the initial defaults. Automatic perennial
owners are excluded by using their preserved pre-override owners. Archived
group assignment history remains intact. Defaults persist when inventory
disappears after cutover. Replacement import IDs receive fresh row authority;
the system does not infer physical-stock lineage.

Issued Eval Work keeps its recorded assignees. Membership/source identity
checks still reject stale work when source rows genuinely change. Historical
published work, actuals, delivery records, and finalized Pikes snapshots remain
unchanged. New inventory-derived lookups use exact row IDs; authoritative
unassigned results never fall back to an Itemcode/Genus owner.

## Import and release boundaries

The cloud release applies database and backend support before publishing the
frontend. Activation requires a complete ready master snapshot and a verified
backfill. Conflicting current seed candidates stop activation.

Inventory statement triggers resolve affected rows. Fenced imports defer
assignment publication until the complete import finishes. Disappeared row
records are retained as historical records and excluded from current views.
Dataset revisions refresh assignment caches, and the browser cache schema
changes for this authority cutover.

The read-only preparation check on October 6, 2026 found 9,539 source rows:
416 ordinary perennial rows, 25 perennial rose rows, 9,092 outside rows, and
six unresolved rows. Current saved assignments had 3,101 consistent active
defaults and 125 without an active owner, with no current candidate conflicts.
The release runner rechecks readiness and candidates; these observations are
not a substitute for the deployment gate.

## Validation

Focused client checks cover exact-row isolation, explicit unassigned values,
idempotent retries, revision conflicts, retained edits, and stale acknowledgments.
Compiled phone/desktop coverage exercises filters, export, touch controls, and
default edits without changing perennial siblings. Disposable database checks
cover policy boundaries, ownership transitions, authorization, import fencing,
audit behavior, and issued-work compatibility. Full builds and browser matrices
run in GitHub Actions.
