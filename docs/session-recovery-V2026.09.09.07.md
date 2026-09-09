# Session recovery — V2026.09.09.07

## Changes

- Temporary native session/profile failures retain credentials and use an authenticated recovery state instead of password reauthentication or global sign-out.
- Session events adopt refreshed credentials immediately. Session/profile operations are single-flight, time-bounded, and guarded against late logout/account-switch responses.
- Successful native login no longer falls through to legacy login when the bridge is unavailable. Required password changes remain enforced without revoking other devices.
- Request permission refresh retains independently authorized modules, provides failure feedback with or without a saved snapshot, and uses bounded reconnect/foreground recovery.
- Shell replacement defers while editing/uploading, cannot repeat the same build navigation, and does not delete the database holding Request drafts/blobs.
- Recovery diagnostics are sanitized, bounded to 32 records per tab, expire after one day, and flush only under the same authenticated profile.

## Verification

- Compiled production shell: 42 Chromium/iPhone recovery scenarios passed, including profile/session failures, reconnect, revoked sessions, account switches, forced password changes, draft preservation, late passkey results, and confirmed session loss without an SDK sign-out event.
- Pilot regressions: 600 passed. Photo regressions: 95 passed. Live-sync regressions: 75 passed.
- Existing login/photo Chromium/Android browser checks: 40 passed.
- AV Blanks desktop/iPhone: nine initial passes; the remaining iPhone scenario timed out under simultaneous browser load and passed when rerun alone, without changing assertions.
- Inline validation, live shell build, and V2 production build passed.

## Release boundary

No migration, role/permission grant, historical evidence rewrite, inventory quantity change, or email resend is part of this release. New recovery browser tests run before Pages publishing and again against the exact live build with business traffic blocked. Existing unrelated worktrees remain untouched.
