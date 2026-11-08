# Canonical engine ownership

Use `.agents/skills/agdata-canonical-engine/SKILL.md` for every change below
this directory. This directory owns pure exact-row identity, canonical
inventory hydration, row evaluation/photo publication models, and durable
completion-receipt rules. It does not own DOM presentation, raw network
transport, or shell navigation.

Keep modules below 400 physical lines. Keep changed functions at or below 60
physical lines and control nesting at or below three levels. Extend the
existing canonical owner instead of copying row logic among Drive, AV, Que,
Reclass, Request, Suspend, and Docks.

Tests must include a matching safe receipt and negative wrong-row,
wrong-account, stale-generation, or incomplete-evidence cases appropriate to
the change.
