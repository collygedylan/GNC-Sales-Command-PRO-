---
name: agdata-mobile-touch-and-keypad-guardian
description: Maintain responsive AV search, isolated custom measurement keypads and dark-emerald mobile controls.
---

# agdata mobile touch and keypad guardian

## Owned Files, Canonical Functions & SQL Contracts
Item Detail keypads, saved-note picker, AV search and first card window.
assets/app-runtime.js (applyDetailMeasurementKeyboardInputState, handleDetailMeasurementKeyboardButtonPress, openDetailMeasurementKeyboard, renderAVOpenCardsChunked), assets/app-shell-style-16.css.

## Cross-Layer Blast Radius
Use the existing switchView, goBackUniversal, header/search ownership and modal Back handlers. Preserve identity-scoped READY/LKG reads and server-authorized mutations. A skill does not authorize a deployment or email send.

Use docs/architecture/agdata-module-dependency-map.md for the canonical shared contracts. Runtime/Apps Script changes preserve SQL mutation authorization and READY/LKG reads; the scoped SOC migration changes staging cleanup only.

## Focused verification
```sh
node --test tests/operational-resilience.test.mjs
```
Run tests/operational-resilience.test.mjs; golden Invariants 359–360 and scripts/enforce-all-14-gems-gate.mjs own these contracts. Retain Planting Invariant 355. Browser timings are measured on hydrated data; physical native keyboard behavior needs device verification.

Custom fields retain readonly and inputmode="none" through keypad close.

## Forbidden Anti-Patterns (Never Repeat)
- Never enable the native keyboard while the custom keypad is active, double-handle touch/click, or accept shear taps during keypad layout transitions. Never defer AV input repaint until typing stops. Never introduce white saved-note dropdowns or AV filter pills.
