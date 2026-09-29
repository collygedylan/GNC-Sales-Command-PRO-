# Local login network trace

The optional login trace records a short, in-memory diagnostic during a login or session-restore attempt. It does not upload telemetry. It retains at most three attempts and 128 events per attempt, and automatically ends a capture after two minutes without cancelling the login flow.

The trace contains only approved endpoint labels, HTTP methods/statuses, relative timing, allowlisted phase names, coarse error classes, limited resource-timing sizes, and long-task durations. Phase and fetch events appear as `pending` when the operation starts and are updated when it settles, so a manual download during a stall still identifies the in-flight work. Concurrent fetches carry active phase hints; they do not claim a unique owner phase. The trace does not save request URLs or query strings, headers, request/response bodies, usernames, tokens, raw error messages, or resource attribution. Use it only on the affected browser and download it manually after the failure.

## Download a trace

1. Reproduce the slow or failed login once, then use **Download login diagnostics** on the login screen if it appears.
2. If the button is unavailable, open DevTools Console and call `GncLoginTrace.download()` after the attempt.
3. Attach the resulting `gnc-login-network-trace.json` to the incident report. The file stays on the device until you choose to share it.

The trace phases separate client-side setup and SDK work from individual fetches. Compare each phase's start/duration against its labeled fetch events: time before the first fetch points to SDK/client setup, fetch duration covers the request through response headers, and remaining phase time includes response-body handling and other SDK work. Cross-origin Resource Timing may hide `requestStart`; the trace marks that unavailable rather than estimating an OPTIONS preflight duration.

For the exact browser-level OPTIONS preflight and request Timing breakdown, use DevTools **Network**, enable **Preserve log**, reproduce once, and inspect the relevant request's **Timing** tab. Share only the timing values and endpoint label. Do not export a HAR: it may contain authorization headers, cookies, tokens, URLs, or request bodies.

The trace is local and bounded. `GncLoginTrace.snapshot()` returns its current JSON-safe data and `GncLoginTrace.clear()` removes retained attempts from memory.
