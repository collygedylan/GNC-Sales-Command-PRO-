# Feature foundation and fast change workflow

This foundation makes lifecycle behavior explicit without rewriting existing screens. It is not a new authorization system, router, persistence layer or release bypass.

## Ownership contract

`window.AgMetricLifecycle` is installed once from `assets/app-lifecycle.js`. The compiler embeds that same source in the early HTML, before the deferred runtime. A failed runtime download therefore cannot disable Reload cleanup. Do not copy its implementation into a feature or introduce another document-navigation AbortController.

- `getSignal('document' | 'session' | 'view')` returns the current lifetime signal. Capture it per operation; never keep it across restoration. Document navigation invalidates all lifetimes; session reset invalidates session/view; changing the primary view invalidates view scopes.
- `createScope({ lifetime: 'view', foreground: false })` creates an operation scope. It exposes `signal`, `isCurrent()`, `guard(callback)`, `timeout(callback, milliseconds)`, `idle(callback, options)` and `dispose()`. Timers return cancellation functions. Dispose in `finally` or on feature teardown; disposal is idempotent. Foreground scopes also end when the document becomes hidden.
- `suspendNavigation(committed)` and trusted browser restoration are shell responsibilities. A committed departure cannot be undone by a stray focus/click. A trusted pageshow unlocks restoration even if initially hidden. New scopes are required after restoration; old scopes never revive.
- `resetSession()` is called synchronously when identity is cleared or live-sync session state resets. It fences client work; it does not sign out, revoke tokens or grant access. Ordinary same-account token refresh does not reset scopes.
- `enterView(key)` and `subscribe(callback)` are shell-adapter APIs. Subscribe returns an unsubscribe function; events contain only `type` and `reason`. Keep callbacks synchronous and bounded. Retain domain-specific snapshot/revision checks.

The old shell signal helpers and `productionLiveSyncNavigation.signal` are compatibility adapters to this owner, not independent controllers. Shell maintenance scheduling and live-sync polling use scope-owned timers. Legacy feature-specific visual and persistence handlers remain; migrate them when that feature is changed, not in a wholesale rewrite.

## New or changed features

Keep a feature's state, rendering and actions inside its module. Receive its root element, lifecycle and service functions through a factory; expose `mount`, `update` and idempotent `dispose`. A temporary shell adapter may forward old entry points. Do not mutate another screen's globals or install feature-owned beforeunload/pagehide/session watchers.

```js
const scope = lifecycle.createScope({ lifetime: 'view', foreground: true });
try {
  const rows = await services.readRows({ signal: scope.signal });
  if (!scope.isCurrent()) return; // Required even if the transport ignores abort.
  renderRows(rows);
} catch (error) {
  if (scope.isCurrent()) showReadableError(error);
} finally {
  scope.dispose();
}
```

Aborting a fetch does not undo a server write. Keep existing durable drafts, outboxes, receipt reconciliation and idempotency keys. Do not automatically retry writes on visibility/online events, clear a pending submission as successful, or create a new idempotency key for an uncertain retry. UI completion must also pass the appropriate scope/identity fence. Authorization and recipients remain server-owned.

## Repeatable working loop

1. Start in an isolated canonical worktree from freshly fetched live main. Preserve divergent checkouts, reference copies and unfinished work. Record the affected screens/services and one falsifiable regression before editing.
2. Run `npm run check:foundation` for lifecycle/shared-shell changes and before sealing a feature candidate. It runs syntax/contracts, builds a fresh complete isolated site, then runs the small Chromium/WebKit suite serially with zero retries. Its report and generated site are under ignored `.gnc-local`; it is local feedback, not candidate proof. No production service or real email is used by fixtures.
3. Run the affected feature tests against that fresh compiled site, not source fallback. For ordinary module-only edits iterate on that module's focused tests first; do not run the entire Home matrix after every edit. Shared navigation/session/read changes additionally require Home startup, Request cancellation and account-isolation regressions; delivery changes require their existing receipt/idempotency/backend tests.
4. Obtain one bounded review, synchronize the next unused release version, seal the candidate commit and dispatch full validation once. CI builds one immutable artifact; the mandatory foundation gate runs before functional/feature suites. Database, timing, Lighthouse and every existing safety lane remain required.
5. Reuse exact-commit passing evidence; use the quiet watcher. Perform fresh protected health and the exact candidate check immediately before normal fast-forward promotion. Publish the existing sealed artifact only after script compatibility. Require hosted foundation and all other live checks, then save recovery evidence.

If a focused check fails, preserve its trace, identify the cause and add a deterministic regression; do not dispatch full CI to discover the same failure again. An unknown affected area requires broader inspection/testing, not an assumption that it is isolated.

## Time, credit and regression discipline

- One implementation owner and one bounded review. Use mechanical tooling for waits/results; use specialist review only where it adds independent value. No repeated unchanged status polling or duplicate investigations.
- Record diagnosis, implementation, validation, deployment and verification with `ops:record`. Record unavailable model/usage honestly. Account usage includes other work and is not exact task cost.
- Reassess after ten minutes without a clear cause and report scope/status at thirty minutes of active repair. Separate automated wait time from active work. These are checkpoints, not a promise every feature takes thirty minutes.
- One full candidate plus at most one corrected candidate under repository rules. A repeated unexplained failure stops promotion and triggers diagnosis, not blind reruns or weaker gates.
- For each regression keep a short cause record: symptom, affected boundary, deterministic reproducer, fix, source SHA and passing run. Classify app defect, fixture defect, build/artifact mismatch or infrastructure/auth failure so unrelated fixes are not mixed together.
- Measure local feedback and release-stage durations for the next three changes. Aim for a small foundation browser run, rather than a broad feature sweep; report measured results before claiming time/credit savings.

Dedicated HTTPS/service-worker integration, production-scale database fixture expansion and extraction of whole legacy screens are follow-ups, not part of this release. Existing VM service-worker tests and full release database tests remain mandatory. No paid service or business-data mutation is needed for this foundation.
