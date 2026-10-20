---
name: agdata-bloom-and-request-specialist
description: Maintain AgData Bloom Picker, Request creation, Historical Requests, Sales and Sales Office workflows and their recipient rules.
---

# Bloom and requests

Preserve the persistent Selected Rows tray, its six inventory metrics, swipe-to-remove, and CLEAR BLOOM PICKER. Selection and per-item drafts survive navigation and background refreshes within the same account.

The nine Bloom actions are Assign, Eval Work, Submit QC, Request, Location Move, Flyer, Take Back, 2nd Cut, and Shear. Preserve every existing action and its permissions.

CREATE REQUEST follows the existing five selection/specification steps, then email review:

1. Who requested this? Select Sales Rep.
2. Select Customer from the prefetched local dictionary.
3. Select Consignee.
4. Select Request Folder.
5. Complete sequential ITEM 1 OF N specifications without losing earlier selections.

Then Add People To Email uses TX, OK, NE, ADMIN, EVAL, ADV, ALL and CLEAR filters. Always include the deduplicated required recipients dylan_collyge, megan_kelly, the submitter and selected sales rep. Preserve explicit selected recipients and existing authorization. Request recipients differ from the stricter Reclass policy; use the queue-and-reclass skill for that workflow.

Preserve Request, Historical Requests, Sales and Sales Office views and their account boundaries. Submission is idempotent with inflight protection; retain a failed draft for retry. Validate payload continuity, territory filters and recipient sets with focused Node tests. New startup/background reads need explicit fixture allowlist entries in the same commit.
