# Request render verification follow-up — V2026.09.09.04

Includes the complete V2026.09.09.03 login/Home/sync/photo repair. That release passed Pages and exact-live browser canaries, but the post-deploy health probe observed two authenticated Request render failures at 2026-09-09T15:33:33Z and 15:33:43Z. Existing sanitized telemetry did not establish the exact cause.

Exact-source reproduction found that delayed Request render verification could outlive its row or view and emit a false error after closing the Request. It could also require a visible AV Note even when the existing Hold/Stop policy intentionally hides that field.

This follow-up binds verification and retries to the same Request identity, detail generation, login ownership and active visible Request tab. Stale checks do not reopen views or report errors. All four structural controls must still exist; AV Note visibility follows the existing policy while the other controls and meaningful form height remain mandatory. A genuinely broken active form still reports a failure.

No completion rules, permissions, inventory data or health-event history are changed. The original health events remain intact; their aging out alone is not evidence of a repair. Browser and exact-function regressions cover stale callbacks and intentional AV hiding separately from real rendering failures.
