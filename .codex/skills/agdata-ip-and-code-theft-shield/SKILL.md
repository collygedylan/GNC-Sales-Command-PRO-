---
name: agdata-ip-and-code-theft-shield
description: Restrict browser API origins while preserving legitimate signed worker traffic.
---

# agdata-ip-and-code-theft-shield

Allow HTTPS agmetricapp.com, www.agmetricapp.com and genuine subdomains of github.io; allow HTTP/HTTPS localhost and 127.0.0.1. Reject suffix spoofing, credentials, null and malformed origins. Origin-less signed relays still require existing authorization. Public browser assets remain downloadable: this is an API-use boundary, not source-code secrecy.

## Owned Files, Canonical Functions & SQL Contracts
Canonical functions: normalizeStoragePublicUrl, normalizeStoragePhotoRequest, isAllowedAppOrigin and ph_prune_supabase_bloat_v1.

## Cross-Layer Blast Radius
Read [the dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and agdata-symbol-index.json. Runtime/SW quota controls, app-api origin/telemetry, SQL normalization/RLS/retention and CI receipts are scoped together. Code.gs imports/delivery, native auth, mutation grants and shared Back/navigation (goBackUniversal) retain their contracts. No new startup read is added.

## Focused verification
```sh
node --test tests/supabase-quota-security.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)
- Never turn cache misses or telemetry into idle polling, expose protected tables through a blanket read policy, delete referenced receipts, or reject an empty CI-owned receipt without checking the installed contract. Invariants 323–326 and Locks 11–13 cover these seams.
