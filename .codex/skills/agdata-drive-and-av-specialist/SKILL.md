---
name: agdata-drive-and-av-specialist
description: Maintain AgData Drive Mode, AV, Inventory, inventory metrics, drill-downs, and EXPORT EXCEL using complete authorized snapshots.
---

# Drive, AV and Inventory

Use this skill for Drive Mode, AV, Inventory and EXPORT EXCEL. Read the zero-lockout guard when changing hydration, cache or row-opening behavior.

- Hydrate the complete published DriveAround snapshot in the background, including all pages. The historical fixture has 9,487 rows and the reference inventory has 9,486+ rows and 1,566+ Common Names. These are reference sizes, never hardcoded production completeness thresholds. Compare hydration with the published snapshot row count and derive the complete A–Z Common Names index from that same authorized snapshot; never substitute a 38/75-name slice.
- Preserve the drill-down hierarchy: COMMONNAME → CONTSIZE → SEASON → location/lot cards. EXPORT EXCEL uses the complete authorized result, not only mounted cards or the current page.
- Keep all six metrics on single lines: On Hand, Review, Available, Open Stock, Loc Photo Match, and Loc On Hand. Preserve their meanings and distinguish location totals from individual lot quantities.
- Compute numeric Loc On Hand deterministically across every lot with the same itemcode + locationcode in the complete same-account snapshot. A known stock total must not display `--`. Do not invent zero when data is genuinely unknown.
- Preserve PRI, quality flags ORANGE / NS 1.0 / LD, and Code / Reason / Since strips. Follow the existing source-of-truth field mappings rather than guessing substitute columns.
- Cache inventory indexes and dictionaries; opening a card must not wait for a fresh network query. Preserve user drafts while a row refresh completes.

Before changing metric math, sorting or hydration, trace ERP → published Supabase snapshot → fixture projection → rendered card. Cover aggregation across lots, full pagination, A–Z completeness and export parity with focused Node cases. Apply the release governor for changed rendering and update this skill when its contracts change.
