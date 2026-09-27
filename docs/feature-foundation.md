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
2. Synchronize the next unused release version, then run `npm run check:local` once for the logical change set. It invokes `check:foundation` once (syntax/contracts, one fresh complete isolated build, Chromium/WebKit smoke), then selects affected checks with the same mapping used by `npm run test:select`. Browser suites run serially with zero retries against that exact site. Evidence and failure traces stay under ignored `.gnc-local`. This is local feedback, not candidate proof.
3. Selection includes committed branch changes from the merge base with `origin/main`, staged/unstaged changes and untracked files. `live-src/change-impact.json` maps known boundaries. Unknown paths are printed and run shared startup, Request and account-isolation checks; inspect the edited behavior and add its mapping before claiming feature coverage. `index.html` remains a shared monolith: its shared checks cannot infer every feature inside it. Delivery/backend changes still need their existing focused contracts and the isolated database/functions candidate lane. See [local validation](local-validation.md).
4. Obtain one bounded review, seal the candidate commit and dispatch full validation once. The local dispatch guard requires passing source and artifact fingerprints; changes since local validation require a new local run. CI builds one immutable artifact; the mandatory foundation gate runs before functional/feature suites. Database, timing, Lighthouse and every existing safety lane remain required.
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
