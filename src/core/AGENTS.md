# Core ownership

Use `.agents/skills/agdata-core-sync/SKILL.md` for every change below this
directory. This directory owns authenticated state, fail-open reads, cache and
snapshot coordination, live-sync orchestration, and bounded Supabase data
access. It does not own DOM rendering, workflow navigation, or canonical
inventory/evaluation math.

Keep modules below 400 physical lines. Keep changed functions at or below 60
physical lines and control nesting at or below three levels. Publish explicit,
account-scoped state and receipts to consumers; do not introduce another cache,
permission authority, timer loop, or mutation owner.

Before editing, read the repository `AGENTS.md`, `.gnc-local/latest-state.md`,
`docs/architecture/agdata-symbol-index.json`, and the relevant dependency-map
slice. Verify all four callers for cross-layer changes: browser PostgREST,
Apps Script, app-api, and Postgres functions/triggers.
