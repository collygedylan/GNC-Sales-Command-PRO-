# Live runtime modules

`runtime-modules.json` is the ordered source manifest for gradual extraction from the legacy inline runtime. The compiled application still emits one deferred runtime asset, so adding a source module must not add a browser request or change startup ordering.

Each extracted module must be a classic-script IIFE in `live-src/modules`, declare every module dependency and every `window` or `globalThis` assignment in the manifest, and expose an internal lifecycle contract with `mount({ root, lifecycle, services })`, `update(snapshot)`, and idempotent `dispose()`. Existing global handlers remain compatibility adapters until their callers migrate.

Move one cohesive area per release, starting with pure helpers and leaf presentation. Authentication, session, navigation, business writes, and delivery remain in the legacy runtime until their higher-risk migrations have dedicated compatibility coverage.
