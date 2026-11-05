# AgData Test (T)

Install URL: https://agmetricapp.com/test/index.html

This standalone application uses the AgData v2.3.179 shell and its existing workflows, plus six test operational consoles. Its install identity, T icons, service worker, browser storage, database namespace, native identities, object storage, import folders, Realtime subscriptions and outbound sender are isolated. Open **T · Farm Operations** to access Hidden Lake, Wingding, Docks, Mistakes, Suspend and Traffic. The original AgData views remain available through the normal navigation.

## Data and identity boundary

The read-only production donor is kzrnyjsosryejjejliii. The dedicated target is apztnscvagayslumnalr. Application tables/functions use public.test_*; private schemas use test_* names. The clone copied 477 physical tables and 21,752,772 rows, including archived history and partition rows, with 1,017 functions, 76 invoker views, constraints, indexes, triggers, policies and 41 restored identity columns. Table-copy receipts are resumable; this is a table-by-table clone rather than a single cross-table transaction snapshot. Managed Supabase system schemas and obsolete backup schemas are not restored over the sandbox platform.

Sixty-nine application identities were recreated with their source UUIDs and password hashes under @agdata-test.invalid aliases. Existing access-code/password login continues through the cloned authorization functions. No signup, password-recovery or identity email can target a production address. Private credential and delivery tables remain inaccessible to browser roles. Twenty-seven test relations participate in Realtime.

Historical delivery records are ineligible for sending. Copied active import leases are retired once, preserving their historical cursor/receipts. Production push, ML and external dispatch functions are inert; Reclass transport, email delivery and cloud imports have dedicated test replacements. No production database, runtime file, Apps Script deployment or sender is changed.

## Operating the test consoles

- Hidden Lake joins purchase orders, inventory, SOC and reserves by normalized item family, requiring unambiguous exact-row allocation. C.12.000 has 23 numbered bays and an unconditional 11-active-bay cap. PO-bound moves check remaining quantities; deviations create a detailed inquiry and trapped email event.
- Wingding contains units 200–240 and pullers 001–080. Initial puller names are test placeholders with BLANK quality; use the authorized editor to enter actual names/tiers. Driver/helper pairs derive ESP/SP/BLANK eligibility, respect unit capacity, and sort rush work before spatial routes. Breakdown swaps require the exact authorized Tanner/Jack/Tyler identity or dylan_collyge; no other administrator inherits that permission.
- Docks enforces field arrival, staging, tagging, checker verification, inspector/loading and final sign-off. The 10% inspector gate and 95% palletization condition use integer quantities; any remaining quantity must be isolated. Pink-tape stock cannot be loaded.
- Mistakes requires an actual stored bad photo for R-all and bad/good photos for R-[N]. F1/S1 replacements use locked exact inventory rows and atomic multi-bay SOC/Docks splits. Negative mutation quantities and overdraws are rejected.
- Suspend includes Dock 38/39 lines, local weekday colors and reviewed exact-location replacement. Evaluation delegates to the canonical physical-tag editor. Mark Done saves evidence and retains the card for supervisor clearance; Complete Tag owns removal.
- Traffic separates check-in and completed orders, elevates live-driver loads immediately, tracks integer shipped/ordered quantities, and exports a real PDF manifest with driver/inspector signatures and trailer seal. A sub-three-hour turnaround is an operational goal, not a measured result of this deployment.

## Five-source imports

Use **T · Farm Operations → Test import files** to upload DRIVE, CAV, RESERVES, SOC or HL PO into farm-operations-staging/erp-drops/<source>/. Then use the original **Home → Run Script**. The canonical parser, staging, publication, lease, relay and receipt logic runs against the test database. The Storage adapter replaces Drive REST and requires no production Drive credential. Only a confirmed publication moves a file into that source's Processed folder. Production drop folders are never accessed.

A real 58-row CAV file was published through this path: all five sources checked complete, all 58 business rows remained identical, and the file moved to the isolated Processed folder. Empty-source checks use UP_TO_DATE receipts. Optional Gemini credentials are not a deployment gate; AURA retains its deterministic inventory fallback and the consoles provide deterministic snapshot answers.

## Media and mail

New media uses farm-operations-staging. Mistake photos are downsampled to at most 1920×1080 at JPEG quality 0.8, with real upload progress. Three authenticated 8,673-byte JPEG upload samples measured 474, 179 and 212 ms. This does not guarantee every device/image upload remains below 500 ms. Existing public donor photos are copied on demand by a size-bounded, read-only-source proxy; a 4,919,743-byte image was verified in the isolated bucket.

SQL rewrites nested recipient fields before insert/update. The isolated signed Apps Script sender discards CC/BCC and sends only to dylan_collyge@greenleafnursery.com. Durable receipts prevent duplicate delivery; ambiguous sends require review. New events wake the test worker immediately, with a two-minute retry cron. Sender authorization and quota access were verified; mail behavior was tested with a mocked MailApp. A signed renderer probe validated a 668-byte PDF with emailsSent: 0. No validation email was sent.

## Validation and release

Evidence lives under G:/My Drive/GNC/AgData/Release Evidence/. Focused checks cover six-console DOM rendering/account isolation, namespace and Storage boundaries, model rules, PDF structure, mail trapping/replays, import transport, and nine rolled-back SQL workflows including the canonical exact-row note/save receipt. The final receipt records syntax checks for every test asset script. Nine append-only sandbox SQL invariants live in tests/golden-invariants.test.mjs; production invariant numbering is unchanged. Eleven test Edge functions are deployed with --no-verify-jwt; their handlers retain authentication. No Computer Use or forbidden release runner is used. The shared production pre-commit suite reports 20 existing failures while production source and golden tests remain identical to origin/main bbec1af47fb5f07643ae5d7a83d91d760d0868f9; the failure list is retained in agdata-test-production-baseline-gate.json. Production assertions are unchanged. This isolated release uses its passing scoped checks and a commit-only hook exception; no production publication is attempted.

The sandbox disk was expanded from 8 GB to 40 GB to hold the clone. Optional providers and external credentials do not block the deterministic test workflows. Browser/device performance and real crew turnaround have not been measured. The final release receipt records source/Pages commits, production-root tree preservation and HTTPS verification.

## Reproduction

Keep credentials only in ignored .gnc-local files. tools/clone-database.mjs reads the saved donor catalog and resumable row receipts, then restores identities and namespace metadata. Apply test database migrations in the documented dependency order: operations, HL replenishment, storage, sync storage, email worker/wake, Reclass transport, bootstrap state, Realtime and exact-row notes. Never rerun donor clone scripts against a production target. tools/assemble-test.mjs rebuilds the donor-derived source and retains the test modules; tools/prepare-static.mjs curates only public assets into the shared _site/test directory. tools/deploy-test.mjs checks and deploys only test-* functions to the explicit sandbox ref.

See [the production promotion procedure](docs/production-promotion.md). No test code, data or credentials are promoted automatically.
