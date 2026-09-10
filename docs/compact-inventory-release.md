# Compact inventory loading — release 2

Target shell: `V2026.09.10.02`. Publish only after release 1 is live and this exact commit passes its independent candidate checks.

## Boundary

The native revision-verified master adapter reads all authorized physical rows using the versioned 161-field list contract. Short field aliases reduce repeated JSON key bytes without changing values. Every alias and identity is validated; there is no truncated first-page result or wildcard fallback. Account, permission, source revision and query identity remain part of cache validation.

List completeness is separate from full exact-row completeness. Editors obtain full rows by exact IDs through the existing authenticated read boundary, behind the same before/after revision checks. These full snapshots remain separate from the list and from editable drafts. Reclass and Sales Office exports obtain their necessary complete scopes; missing or ambiguous identities fail with retry guidance instead of filling unknown fields with zeroes or blanks.

Decoding, formatting, search fields and master lookup Maps are prepared in detached, cancellable chunks before an atomic publish. Existing season-assignment and inheritance operations stay in their current commit order; this release does not claim every synchronous application transform has been removed.

## Measurements and acceptance

The same full-schema synthetic 128-row fixture measures 616,168 bytes for full objects and 263,528 bytes for the aliased list: a 57.231% reduction. A bounded read-only production aggregate measured 53.491% reduction for the same 128 source rows. These are JSON body representations, not promises about compressed production egress or future data distributions. See `inventory-list-projection.md` for the field contract and limits.

Contract, detached staging and exact-detail unit tests exercise missing fields/rows, duplicate identities, revision/permission fences, account changes and cancellation. Compiled browser, release regression, exact-live and hosted health results must be recorded before marking this release complete. No migration, permission change, import rule, business-data rewrite or email change belongs to this release.
