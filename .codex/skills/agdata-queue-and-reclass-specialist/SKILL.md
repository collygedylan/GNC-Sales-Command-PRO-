---
name: agdata-queue-and-reclass-specialist
description: Maintain AgData Que SUSPEND and REQUEST, physical tag-row identity, inventory joins, atomic Reclass updates and Reclass report recipient restrictions.
---

# Queues and Reclass

- Que → SUSPEND represents one physical spreadsheet row as one card using the unique tag line ID. Never collapse distinct physical rows because item/location/lot values match. Preserve Que → REQUEST behavior.
- Use natural alphanumeric locationcode ascending as the primary queue order, with stable existing tie-breakers. Build deterministic inventory joins from itemcode, locationcode and lotcode against the complete master DriveAround inventory Map.
- Reclass Item Inquiry supports atomic live updates for Move Up, Move Down, Hold/Stop, Priority, Loc PTN1, Loc Note and Sales Note. Preserve payload state, permission checks, deduplication and inflight protection. Open immediately from the displayed card; background refresh cannot replace a user draft.
- Pair each successful Reclass mutation with its durable full GNC PH Reclass Item Inquiry HTML and PDF report handoff. Delivery success is distinct from a queued outbox record; report only the state actually verified.
- Reclass email recipients are strictly the deduplicated set of dylan_collyge, megan_kelly and the submitting user. Never include jd_jones or sunday_ellis through SQL outbox defaults, Code.gs, Edge Functions, UI defaults or alternate recipient expansion. If submitter identity conflicts with an explicit exclusion, stop and resolve the business-rule conflict rather than silently send to a forbidden recipient.

Test physical-row identity, numeric/natural ordering, lot-specific joins, duplicate submit attempts and exact recipient policy in Node. Validate changed atomic transaction contracts only in an isolated database; preserve production RLS/RBAC. The 100-source atomic batch limit is inclusively 1,000 ms; other interactive queries remain below 100 ms. Update matching fixture routes and this skill with new contracts.
