---
name: agdata-field-ops-and-qc
description: Maintain AgData Manager, Managers, QC, Production and field work queues while protecting in-app tasks and overwintering notes from ERP imports.
---

# Field operations and QC

Cover Manager / Managers, QC, Production, LOCATION MOVES, RECOUNT, SHEAR LIST, EVAL WORK and BUNCH NOTES. Preserve the existing role permissions and crew workflow in every queue.

- Sort locationcode naturally ascending for single-pass nursery work. Preserve distinct task and physical-row identity and stable ordering within a location.
- Daily DriveAround ERP imports must preserve active in-app queue tasks and overwintering bunch notes. Identify protected live fields before changing mappings, staging, triggers or publication. Do not treat missing ERP fields as an instruction to clear user work.
- Link Hold/Stop reasons and quality flag grades to live inventory with existing item/location/lot identity. Do not reinterpret grades or invent reason codes.
- Keep loaded same-account work visible during import and permission refreshes. Manager and Docks navigation must remain available to authorized users while background checks run.

Use focused tests for sorting, joins and protected-field merge behavior. Test changed import/trigger contracts in a disposable database. Preserve resumable cursors, atomic READY publication and current crew edits through failures and retries. Apply the zero-lockout guard to loading-state changes and update affected skills/fixture routes with new features.
