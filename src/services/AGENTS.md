# Services and release ownership

Use `.agents/skills/agdata-services-release/SKILL.md` for every change below
this directory. This directory owns external service adapters and focused
release-facing service code. Repository scripts, Apps Script, Edge functions,
Watchdog operations, migrations, and publication retain their existing paths
but follow the same service skill.

Keep modules below 400 physical lines. Keep changed functions at or below 60
physical lines and control nesting at or below three levels. Preserve scoped
Apps Script merges, unpublished HEAD drift, durable delivery receipts,
bounded retries, and the required app-api/aura `--no-verify-jwt` deployment
mode.

Release claims require installed-state evidence. Do not equate a queued email,
accepted deployment, or passing static check with live completion.
