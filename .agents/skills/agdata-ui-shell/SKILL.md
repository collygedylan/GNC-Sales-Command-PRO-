---
name: agdata-ui-shell
description: Maintain the AgData global shell, v3.0.35 dark-emerald theme, Table Management workspace, modals, filters, and responsive UI in src/ui. Use for shell/table presentation and interaction; do not change canonical inventory math or raw database transport.
---

# AgData UI Shell

Own src/ui and presentation adapters for the shared shell and Table Management.
Preserve the current palette, typography, header/footer, navigation layout,
theme tokens, and ordered classic-script boot.

## Shell contracts

- switchView, goBackUniversal, global header/search/Back, footer shortcuts,
  modal priority, and view history have one owner.
- Loaded authenticated views stay visible through refreshes. UI state never
  substitutes for server authorization.
- Modal and filter-sheet cleanup releases only its owned interaction/body
  lock. A stale close cannot disturb a newer owner.
- UI click, submit, and change handlers dispatch commands; no raw database
  queries live in handlers.

## Table Management contracts

- Preserve the v3.0.00 directory/workspace hierarchy and each existing table
  controller while styling it with the v3.0.35 dark-emerald theme.
- Assigned Items pins Location between Warehouse and Item Code at at least
  135px. Header titles sit above full-width filters of at least 96px.
- Column facets use positive counts after all other filters. Apply/Enter commit
  checked displayed matches; clearing search restores pre-search selection.
- One vertical row scroller owns table overflow; the selector/filter bar and
  headers remain visible without clipping other retained views.

## Engineering limits and checks

Modules stay below 400 lines; changed functions stay at or below 60 lines and
nesting at or below three. Validate manager-table-workspace,
manager-table-management, assigned-items filters/components, shell navigation,
and any required browser geometry. Source-only CSS checks do not prove layout.

## Forbidden Anti-Patterns (Never Repeat)

- Never expand the docked Request strip beyond 48px, pin a cloned field that does not receive keystrokes, or hide only an AV Note list while leaving its sheet overlay active. Keep the actual focused control above the keyboard and restore its layout on blur (Invariant 619).

- Keep AV Stock and inventory fields first in one horizontal, keyboard-accessible filter rail above the cards. Full-width controls or nested wrapping field bars can fill the mobile viewport before the first card. Keep 44px targets, reuse the current account's synchronous facets, and open native dropdowns above the scroll rail so their options remain clickable.

- Do not let a logged-out account's failed upload markers or dirty-work flags
  trap a later session on an obsolete shell. Clear owned transient state at
  logout; checkpoint restorable work on explicit update and verify activation.

- Do not treat a search, filter dialog, or read-only status request as work
  that prevents an update. Checkpoint the view, and keep the existing
  safeguards for captures, writes, and unsaved drafts.

- Do not apply a generic pinned-results layout to only some of the five Table
  Management routes; shared geometry must have symmetric controller coverage.
- Do not use a late CSS override that clips the selector, filter controls, or
  retained header while a different route still relies on the native layout.
- Do not extract a global layout owner without loading that dependency in every
  isolated browser/geometry fixture that executes its caller.
- Do not let interaction pacing split a declared bounded page of 40 or fewer
  cards into an untracked partial first batch; publish that small page once.

See docs/gemini-clean-gems-blueprint.md for the full ownership map.
