# Workflow view ownership

Use `.agents/skills/agdata-views-workflows/SKILL.md` for every change below
this directory. This directory owns workflow adapters and view state for
operational queues, report selection and drills. It consumes canonical engine
state and service receipts; it does not create alternate caches, raw database
transports, theme systems, or mutation owners.

Keep modules below 400 physical lines. Keep changed functions at or below 60
physical lines and control nesting at or below three levels. A touched legacy
file over 500 lines must shrink as the focused slice moves here.

Preserve universal Back, account/generation fences, exact row handoff, drafts,
filters, scroll, and the current ordered classic-script boot contract.
