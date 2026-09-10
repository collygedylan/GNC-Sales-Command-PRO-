# Inventory list wire contract V1

`assets/inventory-list-contract.js` is the single authoritative field list for
`master-list-v1`: 161 physical `ph_master_inventory` columns, with immutable
positional aliases `f0` through `f160`. Its `buildQuery()` uses explicit PostgREST
column aliases and `order=unique_id.asc`. Aliases are an existing PostgREST feature,
not a new API operation or database migration. See [PostgREST column renaming](https://docs.postgrest.org/en/stable/references/api/tables_views.html#renaming-columns).

The existing authenticated Supabase read boundary and its authorization remain
unchanged. The compact query belongs only to the master list adapter; it must not
replace unrelated owned-dataset reads or exact full-row reads. Integrations must
decode the compact response before `formatFetchedRows` and must include this
contract version in canonical cache identity. Changing a column or alias position
requires a new version, not an in-place V1 edit.

## Preservation and failure behavior

The field set conservatively covers the current master initial fields, Drive
display/filter/detail-header fields, linked-row synchronization fields, inventory
quantities, assignment inputs, evidence baselines and shared search inputs. It also
retains dashboard `filename`, Argos `planstart`, Docks fallback `qa_code`, legacy
spelling variants and AV/Flyer/Docks evidence fields. The tests check the real
application field arrays and execute the real evidence-baseline and Argos source
snapshot helpers. This is field and helper parity evidence, not a substitute for
browser workflow regressions.

The aliases are decoded into canonical lowercase physical names. Every projected
key is required. Unknown keys, missing aliases, wrong primitive types, missing
identities and duplicate identities fail closed with
`INVENTORY_LIST_CONTRACT_INVALID`; there is no guessed full-row fallback. Null,
empty string, text-encoded quantity and numeric value remain distinct. Five
physical `numeric` fields accept finite numbers; the other projected fields accept
strings or null, matching the inspected schema. Omitted fields stay absent. In
particular, decoding must never turn an unknown full-only quantity or price into
zero or an empty string.

`ext_equiv_unit` appears in the application's initial list but is absent from the
inspected physical schema and is not selected. Existing derived spelling mappings
remain application responsibilities: `HRSSEASONBEGIN` from `hsreasonbegin`,
`SEASONSUPPLY` from `season_supply`, `HOLSTOPCODE` from `holdstopcode`, and `PICK`
from `pic_note`.

## List and exact-detail completeness

`markListRow(row)` identifies a canonical list row, not an exact/full row and not
proof of freshness. `markDetailRow(row, context)` records a caller's completed
exact-row verification. It requires the matching unique ID and nonempty string
`scope`, `permissionVersion`, `revision` and `uniqueId`; revision stays a decimal
string, including values beyond JavaScript's safe integer limit. `isDetailRow`
checks that entire fence against the current context. The module does not fetch,
authenticate or verify revisions itself.

Completeness metadata is frozen and non-enumerable so it never becomes a business
field or enters a write/export accidentally. JSON serialization, formatting and
cloning may discard it. The adapter must explicitly retag formatted/restored list
rows. Only a successful, exact, current-scope read may be tagged as detail. Persist
immutable decoded server list values, never the actively edited row or its drafts.

The native master adapter now prepares decoded/formatted rows, search fields and
its three lookup Maps in detached chunks of at most 128 rows, checking an 8 ms work
budget after each row (a single expensive row can exceed that time target).
Each yield rechecks the captured account/permission identity and read generation;
a stage-wide identity Set rejects duplicates even across pages or chunks. The
`_preparedMasterList` payload retains shared references between the data array and
Map values through coordinator cloning and IndexedDB. Publication reinstalls the
list tags and synchronously swaps the complete array and Maps. Preview and commit
dataset states both retain `listProjectionVersion`; a preview still does not mark
the data verified.

This is not a claim that all client work is chunked: coordinator snapshot cloning,
season assignments, crop inheritance, AV derivation and joined-dataset updates
still occur in their established order. In particular, inheritance functions
have shared-state side effects even when remote writes are disabled; staging must
not call them against temporarily replaced global arrays.

Before an operation needs a full master row, integrate the existing
`fetchAuthenticatedSupabaseReadPage` boundary with a master `select=*` read filtered
by the exact `unique_id`, limited to one row. Capture account/permission/revision
and detail-request token before the read, then recheck them before installing the
result; reject absent or mismatched identities. Keep the full server row in a
separate detail sidecar and preserve unsaved form drafts. Do not merge a late full
row into a different detail item or use it as a fresh list snapshot. Opening detail
and deferred detail hydration are integration entry points, not authorization to
change any business operation routing.

Full-only consumers also need exact hydration outside the ordinary detail panel.
The audit identified master fallback reads in
`getSalesOfficeOrderExportMetaRows` (customer/consignee identity, address, city,
state, ZIP, zone and tag) and `getSalesOfficeExportColumns` /
`getSalesOfficeOrderExportExtItemTotal` (unit price). An export cannot silently use a list
row's missing values. Hydrate the relevant master fallback rows before building the
export, while preserving the Sales Office-owned data and existing source
precedence. Other omitted-name references in Docks, Reserve and Bloom belong to
those owned datasets and do not justify globally rerouting them to master.

## Full-only physical fields

These 52 inspected physical columns are omitted from V1. This classification does
not claim they are null forever or unused by every application operation:

```text
concat,isreserve,nationalaccount,idgroup,customeridentityid,consigneeidentityid,
consigneecity,consigneestate,consigneezip,zonecode,tagcode,transactionnumber,
purchaseordernumber,extunitprice,ordertotal,requestdate,stagename,step,customersku,
formattedupc,descriptorcode,quantityordered,quantityshipped,unitprice,
handlingchargeperitem,taggingchargeperitem,combinedprice,freightrateperitem,landed,
retailprice,generalloadinstr,invoicedate,consigneeaddress_1,consigneeaddress_2,
altshipcomment,shiptotelephone_1,okloadinstructions,txloadinstructions,
ncloadinstructions,hlloadinstructions,equiv_uom,wingdingunits,dropweight,
internalinvnote,hardinesszone,tagdeptnote,ext_unit_merch_shipped,ext_eunit_shipped,
avg_price_eunit_shipped,requestdateweek,carrier,si_available
```

## Size evidence and limits

On 2026-09-10 a read-only aggregate sampled the first 128 master rows ordered by
`unique_id`. Only schema names/types, counts, and byte totals were returned; no
business row values were read into this repository. The schema had 213 columns
(194 text, 14 timestamp with time zone, 5 numeric). The same sample measured:

| Representation | Sum of `octet_length(jsonb::text)` |
| --- | ---: |
| Full 213-column objects | 688,921 bytes |
| Canonical 161-column projection | 526,489 bytes |
| Same 161 values with short aliases | 320,409 bytes |

The aliased projection is **53.491% smaller** than the full objects. This is a
bounded same-row JSON representation measurement, not compressed HTTP egress,
an all-master estimate, or a promise that every future row distribution will
achieve the same percentage. Projection alone saves 23.578% on that sample;
short aliases provide the rest without dropping required fields.

`tests/fixtures/inventory-list-schema.json` records the actual schema and observed
marginal non-null count for each column. It contains only explicit short synthetic
stock values, not production values or fabricated padding. The tests construct
128 full-schema rows using those counts, then apply both wire representations to
the identical full rows. This preserves each column's null rate but deliberately
does not claim to preserve real row correlations or value lengths.

That reproducible compact-JSON fixture is 616,168 bytes full, 469,608 bytes projected
and 263,528 bytes aliased: **57.231% smaller**. The test requires at least 50%
reduction on this same fixture. A separate adversarial case makes every omitted
field non-null and proves omitted prices/quantities remain unknown, never decoded
into a false zero/default. Functional coverage must not be pruned to meet the byte
target. Run the contract checks with:

```text
node --test tests/inventory-list-contract.test.mjs tests/master-list-staging.test.mjs
```

An additional same-fixture compression check (Node 24.14.1) measured gzip level 6
at 6,803 → 3,017 bytes (55.65% reduction) and gzip level 9 at 6,379 → 2,977 bytes
(53.33%). Brotli levels 4, 6 and 11 reduced bytes by 42.65%, 48.91% and 44.76%
respectively, below 50%. The synthetic values are highly repetitive and do not
reproduce production entropy, page sizes or CDN encoding. Actual production
encoded transfer remains unmeasured; the JSON-body acceptance result is not a
claim that every wire encoding or production download is 50% smaller.
