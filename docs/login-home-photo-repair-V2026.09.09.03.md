# Login, Home, data status and protected photo repair — V2026.09.09.03

## Scope

Client-only release from a clean worktree based on `3b6e9a4969a72d4bec4dbdb05320da19db257bbd`. No migration, grant, recipient, inventory quantity, historical evidence or orphan recovery change.

## Login and Home

- Authentication attempts and permission requests own a login generation, profile, username and role/division scope. Logout, cancellation, account replacement and superseded permission reads invalidate stale continuations.
- Module and Request access checks run concurrently. Existing profile-backed role rules remain unchanged; roles which consume module permission snapshots fail closed with an authenticated retry screen when those permissions cannot load. Request-only failures display a separate retry state.
- Authorized Home content, its visible tile count and layout, header and footer are prepared behind the login overlay. Empty access has an explicit message.
- Queue/Eval Work and other data loads start after usable frames. Their failure cannot reset successful authentication. Native login no longer schedules a redundant second password login.
- Each data adapter succeeds when its own revision-verified snapshot commits, even when another adapter fails. Overall freshness remains strict: Data Updating, Data Current, Data Update Needs Attention, or Data Offline, with the last checked time and retry details.

## Photos

- Native authenticated upload preflight does not depend on a legacy bridge. Existing server validation remains authoritative.
- Capture the exact physical identity, revision and evidence baseline before creating the preview. Uploaded URLs stay in an actor-scoped retry draft until `save_drive_evidence_v2` confirms the URL on the original row.
- Photo-only writes cannot acknowledge pending uploads via the client NO_CHANGES shortcut. No direct master-table PATCH is used by the protected photo workflow.
- Multiple uploads serialize against advancing canonical photo baselines. Field drafts are not overwritten. Photo conflicts require explicit review and do not replace another field's conflict record.
- Deferred detail hydration preserves only user-edited fields belonging to the current row and session, including intentional empty values and the active cursor. Hosted WebKit exposed the old hydration overwriting a just-typed AV Note before autosave; a deterministic regression now forces that timing.
- Failed saves retain URLs in memory/sessionStorage for explicit retry without reupload. Account changes prevent late acknowledgement from altering another session.
- AV's photo-only controls use the existing Drive Admin/exact-master authorization. Ambiguous catalog rows stay blocked; ordinary AV fields remain read-only.
- Pending uploads and unconfirmed photo drafts prevent shell replacement. The service worker broadcasts updates but no longer forcibly navigates hidden clients that could be using a camera or saving data.

## Verification and hosting

New exact-function tests cover ownership, permission failures, per-adapter verification, native preflight, canonical photo acknowledgements, idempotent retry, multiple uploads, field conflicts, saved-draft recovery and shell guards.

`tests/login-photo-repair.e2e.spec.ts` exercises actual fresh/restored startup and file-input → optimizer → authenticated upload contract → protected evidence save sequences. Chromium, Firefox, WebKit and Android fixtures block external HTTP and WebSockets and replace only remote/authentication boundaries. Tests include frame sampling, 4× Chromium CPU throttling, no unauthorized module flashes, offline retry, logout/navigation races and a second isolated client.

`playwright.login-photo.config.ts` supports `LOGIN_PHOTO_BASE_URL` for the built or exact-live shell. Pages and hosted performance now run these regressions, with mutation-blocked exact-live checks after deployment. Server/RLS protections continue to be exercised by the existing isolated database workflow.

Release verification requires matching `.03` shell, manifest, service worker and deployment commit, successful Pages checks, and production login/performance health. A prior `.02` generic COMMIT_FAILED event at 2026-09-09T13:39:54Z had no identifying workflow metadata; its aging out of the ten-minute health window does not prove that unrelated incident repaired.
