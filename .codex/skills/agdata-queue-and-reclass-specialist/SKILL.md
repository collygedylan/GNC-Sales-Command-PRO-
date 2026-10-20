---
name: agdata-queue-and-reclass-specialist
description: Maintain AgData Que SUSPEND and REQUEST, physical tag-row identity, inventory joins, atomic Reclass updates and Reclass report recipient restrictions.
---

# Queues and Reclass

- Que → SUSPEND represents one physical spreadsheet row as one card using the unique tag line ID. Never collapse distinct physical rows because item/location/lot values match. Preserve Que → REQUEST behavior.
- Use natural alphanumeric locationcode ascending as the primary queue order, with stable existing tie-breakers. Build deterministic inventory joins from itemcode, locationcode and lotcode against the complete master DriveAround inventory Map.
- Reclass Item Inquiry supports atomic live updates for Move Up, Move Down, Hold/Stop, Priority, Loc PTN1, Loc Note and Sales Note. Preserve payload state, permission checks, deduplication and inflight protection. Open immediately from the displayed card; background refresh cannot replace a user draft.
- Pair each successful Reclass mutation with its durable full GNC PH Reclass Item Inquiry HTML and PDF report handoff. Delivery success is distinct from a queued outbox record; report only the state actually verified.
- Reclass email recipients are strictly the deduplicated set of dylan_collyge, megan_kelly and the submitting user, resolved by the server from active profiles and confirmed email addresses. Under the approved v2.3.17 policy, jd_jones receives reports when he submits; do not add jd_jones or sunday_ellis as fixed or implicit recipients.
- Treat the client's inventory revision as an optional hint. Resolve the current revision inside the atomic server transaction, preserve exact source identity/quantity comparisons and command replay protection, and authorize the current actor on the server. A missing cache freshness proof must not block opening or submitting Reclass.

Test physical-row identity, numeric/natural ordering, lot-specific joins, duplicate submit attempts and exact recipient policy in Node. Validate changed atomic transaction contracts only in an isolated database; preserve production RLS/RBAC. The 100-source atomic batch limit is inclusively 1,000 ms; other interactive queries remain below 100 ms. Update matching fixture routes and this skill with new contracts.
