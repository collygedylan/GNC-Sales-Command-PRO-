MASTER DEVELOPMENT ROADMAP: Sequential Autonomous Execution

You are authorized and explicitly commanded to execute the following SEVEN major feature prompts and the Prompt 2.5 hotfix autonomously. You must work continuously until all phases are fully built, validated, pushed, and deployed to production.

STRICT SEQUENTIAL RULES:
1. Execute prompts ONE AT A TIME in this order: 1, 2, 2.5, 3, 4, 5, 6, 7. Do not combine them. Finish and verify Prompt 2 before creating the separate Prompt 2.5 hotfix branch from current `origin/main`.
2. For each prompt, you must branch from the latest `origin/main`, implement the feature, write the regression tests, pass the strict SQL database gate (`node scripts/database-check.mjs --all`), and open the PR.
3. You MUST WAIT for the current PR to merge successfully and verify the cloud deployment is live.
4. You must UPDATE THE VERSION in the app for each deployment.
5. After fixing any CI/CD validation errors, test harness bugs, or legacy linting errors (which you have full authorization to do without asking), and after the deployment is live, you must IMMEDIATELY START the next prompt.
6. You must work through each prompt 1 by 1 and go to the next prompt WITHOUT ANY HUMAN INTERACTION. Do not pause or ask for approval to proceed to the next item.

Acknowledge this sequence, and immediately begin execution on PROMPT 1.

---

### PROMPT 1: App-Managed Priority & Hold Codes (Smart Shield)
FEATURE UPDATE: Our mobile application must become the strict "Source of Truth" for three specific inventory fields: `priority`, `holdstopcode`, and `holdstopreason`.

1. The "Smart Shield" (Database Importer Updates)
Modify the backend Supabase/PostgreSQL importer logic to protect app-managed fields. (Keep this logic in the backend database upsert, not the Google Apps Script):
- When a brand-new inventory row is imported, accept `priority`, `holdstopcode`, and `holdstopreason`.
- Shield UP: When a user changes these fields via the app, mark the row as "Shielded" (e.g., `pending_legacy_sync`). While Shielded, the daily importer MUST IGNORE legacy data for these columns.
- Shield DROP: During the daily import, if a row is Shielded, check if the incoming legacy data MATCHES the app's current values. If they match, DROP the shield.
- Unshielded Sync: If NOT shielded, the importer MUST ACCEPT the legacy values.

2. Dual-Action Submission Workflow (UI & API)
- "Move Up" UI Rule: If a user selects "Move Up", `holdstopcode` and `holdstopreason` must be disabled/hidden and values cleared.
- Action A (Live Edit): Immediately update columns in the live inventory database table.
- Action B (Request Queue): Simultaneously route the changes into the Request queue for keyers.
- Mixed Request Safety: Priority/Hold change executes Action A and B. Quantity Move executes ONLY Action B.

3. Authorized Bulk Hold Propagation (Fan-Out)
- If `dylan_collyge`, `megan_kelly`, `mitch_kaiser`, or `jd_jones` applies a hold to a row whose `season` matches the app's current season AND `salesyear` is <= the app's current sales year, automatically cascade that hold to ALL sibling rows for that item matching those exact conditions. Update ONLY the selected row if initiated from a future row.

4. PDF Generation & Email Continuity
- Ensure changes are formatted on the Request PDF and emailed to active CSR recipients.

---

### PROMPT 2: Card UI Overhaul (Drive Mode & AV) and Que Tab Cleanup
FEATURE UPDATE: Redesign inventory row cards to be compact, professional, and e-commerce ready.

1. Global Card Quantity Logic (All Views)
- Every card in all views must display quantity pills in this exact order: [On Hand] | [Review] | [Available] | [Open Stock] | [Loc Photo Match]
- ADD a new pill: [Loc On Hand].
- Calculation Logic: [Loc On Hand] must dynamically sum and display the total on-hand quantity for all rows that share the same `locationcode` AND `itemcode`.

2. Drive Mode Card Layout (Compact & Professional)
- Row 1: Common Name, etc.
- Row 2: Under "Reclass" button, place `fieldtagcolor`.
- Row 3: Under `fieldtagcolor`, place `source`.
- Remove "Loc Match %" entirely.
- Row 4 (Quantities): [On Hand] | [Review] | [Available] | [Open Stock] | [Loc Photo Match].
- Row 5: Place `spec` directly below `locationcode` and `priority`.
- Row 6: Where "Loc Photo Match" used to be, place `AV Note`.
- Row 7: Below `AV Note`, place `Bloom Picker`.
- Row 8 (Hold Data): Place `holdstopcode`, `holdstopreason`, and `holdstopbegindate` on the same row, in that exact order, directly below `Bloom Picker`.
- Row 9: Place `listprice` directly under `priority`.

3. AV Mode Card Layout
- Matches Drive Mode layout exactly, EXCEPT: Remove/hide the `fieldtagcolor` from the AV card entirely.

4. Que Tab Logic Update
- When a request is removed from the request view in the Que tab, DO NOT send it to "Archived". It must be permanently removed/deleted from the Que view entirely.

---

### PROMPT 2.5: URGENT HOTFIXES — Seven Items and Editable-Field Smart Shield
CRITICAL HOTFIX: Complete and verify this separate release after Prompt 2 and before Prompt 3.

1. Reproduce and repair the fatal **App could not load** error after successful login. Trace authentication, startup reads, schema contracts and priority caching; preserve access controls and surface recoverable failures clearly.
2. Trace `commonname` text through ingestion, Supabase Edge responses, app rendering, PDF generation and Apps Script email payloads. Preserve UTF-8 characters such as registered trademark and trademark symbols without double encoding or corrupting valid Unicode.
3. A hold-removal database update must target only `holdstopcode`, `holdstopreason`, and Priority when the existing removal workflow requires it. Preserve all other inventory data, especially photos, photo freshness metadata, specifications, and measurements.
4. For users authorized to make live updates, selecting **YES** in the **Take off hold?** modal must use Prompt 1's exact dual-action workflow: immediately clear the live hold and queue the Item Inquiry for keyers. Retain existing permissions, revision checks, idempotency, Smart Shield behavior, and delivery.
5. Repair the disabled **Email Item Inquiry** button. Valid current drafts must be submittable after closing and reopening the modal; pending or stale callbacks must not overwrite, close, or disable a newer draft. Preserve duplicate-submit and account-change protections.
6. Apply the Item Inquiry rules below to the active editor, secure submission, and PDF:
   - **A — Fields:** Loc Note = `locationnote`; Rev uses the existing `ptrreviewed` column (`review` is a display alias); Loc PTN1 = `locationptn1`; separate DesigItem/DesigCust/DesigLoc = `desigitem`/`desigcust`/`desigloc`; Pull uses schema spelling `pullerresponsibility`; OS% = `oversellpercentage`; Sales Note = `salesnote`, distinct from Drive evidence `sales_note`. SUS = `suspend`, distinct from `suspendto`. Omit PGC, Brand Label, and Int Inv Note from the inquiry UI/PDF. Preserve read-only identity and quantity fields, including Rev, On Hand, and Available.
   - **B — H/S:** Preserve the original and confirmed values. Show existing H/S data with strike-through and highlight newly supplied data. Keep actual live hold changes tied to the validated hold action.
   - **C — SUS:** Provide Yes/No controls while retaining existing data in the draft. Existing data plus No clears the confirmed field and prints the prior value struck through and highlighted; blank plus Yes inserts verified actor initials and highlights the value.
   - **D — Stamps and highlighting:** Generate Pri By initials, Eval Date, and Pri Update from the authenticated profile and server time in America/Chicago. Generate Note Date only when Location Note actually changes. Eval Date remains inquiry/report metadata; never reuse inventory completion timestamps. Highlight each changed editable field, preserve prior values for review, and keep PDF cells readable across page breaks.
   - **E — Smart Shield and dual action:** On confirmed submission, every editable inventory-field change must atomically update live inventory and queue the Item Inquiry. Protect the specific edited columns until a validated raw legacy source actually supplies matching values; omitted source columns cannot acknowledge a shield. Preserve canonical inventory identity when designation changes alter legacy-generated IDs. Keep drafts/cancellation unsaved and quantity/move/sheared proposals inquiry-only. Preserve permissions, row scope, expected-value conflicts, idempotency, audit history, and existing queued versions.

7. Remove List price from Drive cards and use N/A for their unverified Loc Photo Match metric. Keep all six Drive metrics (On Hand, Review, Available, Open Stock, Loc Photo Match, Loc On Hand) in one horizontal row with card-width typography. Loc On Hand sums every physical inventory row with the same exact itemcode and normalized locationcode across all seasons: D.29.000 with F1=41, S1=491, U2=210, Y=490 displays 1,232. A complete browse projection is sufficient; incomplete or unauthorized data must not be presented as a complete total. Preserve AV prices and photo-verification rules.

Add regressions for all seven items, including cached-client login, Unicode, hold-removal evidence, dual-action atomicity, modal reopen state, field-only and mixed inquiries, independent field acknowledgments, designation identity transitions, server stamps, PDF styling/geometry, six-metric alignment, and the cross-season location aggregate. Bump the release version, run focused checks and the full disposable SQL gate, push the isolated hotfix and immediately create its PR. Wait for cloud validation, merge, deployment, and live verification before starting Prompt 3.

---

### PROMPT 3: FEATURE REPAIR & ACTIVATION: AURA Voice Assistant
FEATURE REPAIR: Our in-app voice assistant, AURA, is currently "totally unresponsive." Rebuild the pipeline to act as a context-aware AI confined strictly to our app's inventory data.

1. Zero-Response Debugging
- Audit microphone permission requests. Catch errors and display visible alerts if denied.
- Ensure the UI thread is not blocked by unhandled promise rejections or hanging websocket connections.
- Provide clear visual UI states: "Idle", "Listening", "Processing", and "Error".

2. Intent Parsing & Routing (Backend/Edge)
- Use an LLM router to classify transcribed text into Category A (Inventory Inquiry -> return a spoken/text answer) or Category B (Action Execution -> Put on request).

3. Action Execution & Validation
- For Category B, construct the exact payload used by the manual Bloom Picker UI and inject it into the standard Request pipeline so it lands in the "Que" tab.

---

### PROMPT 4: Phase 4 (Bunch Notes & Counting Views)
FEATURE UPDATE: Implement the requested Counting and Reporting tools.
- Implement the "Bunch Notes" view allowing rapid, multi-row contextual notation.
- Implement specialized "Counting Views" optimized for mobile field entry.
- Automate the generation and email delivery of PDF completion reports triggered by field worker actions.
- Ensure all new views are wrapped in `React.lazy` boundaries as established in Phase 6, and apply strict SWR data caching to guarantee instant load times.

---

### PROMPT 5: Phase 5 (Global Header & Custom Virtual Keyboard)
FEATURE UPDATE: Overhaul the application's top-level navigation and data-entry interfaces.
- Redesign the Global Header for better mobile responsiveness and faster tab switching across both legacy and React views.
- Implement a custom, context-aware virtual keyboard designed specifically for rapid numerical and SKU data entry within the nursery environment (bypassing native OS keyboards).
- Ensure the new UI components do not introduce unnecessary React re-renders and respect the strict Phase 6 performance budgets.

---

### PROMPT 6: Sales Rep Historical View & Credit Workflow
FEATURE UPDATE: Currently, the app hides past work from Sales Reps. Build a robust "Historical View" and photo-based customer credit workflow.

1. Frozen Data Snapshots & Historical Views
- When a request is fulfilled/completed by a field worker, the backend must create a "Frozen Snapshot" of that request's data and photos. If the live inventory row is updated weeks later, this historical snapshot must not change.
- When a Sales Rep selects a Customer and Consignee, display a "Historical Requests" tab containing these frozen folders.

2. Historical Orders & The Docks Trigger
- Create a distinct "Historical Orders" list for each Customer/Consignee. A frozen request row should only appear in "Historical Orders" once it becomes visible in the "Docks" tab.

3. Customer Credit Application Workflow
- Inside the "Historical Orders" view, allow sales reps to click a row card and select "Apply for Credit".
- The UI must accept a text reason and new photo uploads specifically as evidence for the credit claim.

4. Credit Approval Routing (Strict Auth)
- Build a "Pending Credits" administrative view. ONLY the user `jd_jones` is permitted to view pending credits, review evidence, and click "Approve Credit". API requests to approve must explicitly fail for any other user.

---

### PROMPT 7: Final Performance Pass
FEATURE UPDATE: Complete a dedicated, measured performance optimization pass across the live application and the React beta after Prompts 1 through 6. Preserve business behavior, authorization, data correctness, user workflows, state lifetimes, request cancellation, and compatibility. Optimize only work demonstrated by the existing performance evidence; do not alter benchmark fixtures, sample counts, baseline commits, or strict count/payload/render assertions to manufacture a pass.

1. Re-run the established browser and SQL performance suites against the pinned baseline and candidate using the existing fixtures and sample counts. Keep all read, write, response-byte, equal-result, unchanged-render, cancellation, and correctness checks strict.
2. Restore the original duration thresholds: browser duration may exceed baseline by at most the larger of 25 ms or 15% of baseline; database duration may exceed baseline by at most the larger of 15% or 5 ms. Remove the temporary timing-profile override introduced for Prompts 1 through 6.
3. Use retained per-context diagnostics to identify and fix app-wide bottlenecks in the live and React applications. Preserve cold and warm route coverage, lazy loading, offline boundaries, accessibility, and measured state-lifetime behavior.
4. Validate the final changes with the existing SQL database gate, focused unit and browser tests, lint, type checks, and the full cloud performance matrix. Do not rebaseline, reduce coverage, or drop slow samples.
