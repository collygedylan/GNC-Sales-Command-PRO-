# HL original PO PDF and season balances

Candidate: V2026.09.14.05. The canonical source is the complete original Greenleaf PO Order Report PDF. Quantity Summary imports are rejected. Apps Script sends pages to the protected hl-po-pdf-import worker and resumes staging after interruptions; files are archived only after acknowledgment.

The database migration retains original detail lines in hl_order_private.po_import_rows and generates F1/S1 compatibility read models. Legitimate lines sum by itemcode, size and lot. Blank Remaining in verified PDF columns is zero. Receipts adjust aggregates without modifying imported detail values. The first confirmed PDF initializes fixed 30% targets; later imports do not reset them.

Dylan reviews both lots under HL Orders / PO imports, selects the Chicago receipt cutoff, and confirms the report. Existing data stays active until that confirmation. Target resets require a separate protected preview/confirmation. New SOC uses its exact supported lot; existing saved records retain F1 accounting.

## Deployment order

1. Pass the exact candidate validation with the new migration and Edge checks included.
2. Apply 20260915021525_hl_po_seasons_pdf.sql and deploy hl-po-pdf-import with its pinned dependencies.
3. Dispatch apps-script-sync.yml on the validated branch and confirm reporting/import health before frontend promotion.
4. Place the original PDF in the existing HL import source folder. Preserve the original business document; stage a copy and review it in the app.
5. Promote the exact passing artifact, then verify hosted version, commit, canaries and production health. Staging or reaching main is not completion.

## Local evidence

The supplied 35-page PDF parsed as 384 F1 and 232 S1 detail lines. Sea Green 000310.030.1 remaining balances are 300 / 794; initial targets are 90 / 239. F1 available 154 gives suggested 0.

All five legacy HL SQL suites and the new season SQL suite passed in the isolated PGlite harness. A pre-migration fixture confirmed saved lines/PDFs remain unchanged and legacy S1 source snapshots retain F1 accounting. Twenty compiled browser cases passed across Chromium, Firefox, WebKit, Android and iPhone. PDF parser/import unit tests and the protected worker boundary tests passed. Full required CI and live checks remain mandatory.
