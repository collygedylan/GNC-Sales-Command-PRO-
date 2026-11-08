# Shared UI ownership

Use `.agents/skills/agdata-ui-shell/SKILL.md` for every change below this
directory. This directory owns global-shell and Table Management presentation,
interaction adapters, modal/filter cleanup, and responsive geometry. It does
not own business authorization, canonical inventory math, or raw Supabase
queries.

Keep modules below 400 physical lines. Keep changed functions at or below 60
physical lines and control nesting at or below three levels. A touched legacy
file over 500 lines must shrink as the focused slice moves here.

Preserve the v3.0.35 dark-emerald theme, single universal Back owner, one table
row scroller, visible headers/filter controls, accessible focus, and dispatch-
only UI handlers.
