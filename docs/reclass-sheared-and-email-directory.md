# Reclass shearing and email recipients

## Recipient directory

`app-api` exposes `request_recipient_directory` to the existing Bloom Crop Update
and Request Details email actors. The server resolves the stored active profile;
client role claims or supplied directory filters cannot expand access.

The fixed typed reader returns only username, display name, and role. Profiles
are authoritative when present, including disabled profiles linked to active
legacy accounts. Active legacy-only users remain available. Recipient role,
temporary login locks, and password-change flags do not exclude an active
recipient. The requesting actor still must satisfy normal authentication and
account restrictions. Existing email-address resolution remains in place.

The content revision covers the complete minimal directory. Each authorized
picker opening revalidates it. A changed revision replaces the APP group and
removes selections that disappeared from every available group. Request and Bloom
use this directory independently of task assignment and human chat directories.

## Request-only shearing

V5 uses policy `reclass-action-workflow-v5-sheared-20261008`. The client sends
`{ action: 'sheared', quantity: 100 }`. The database validates the positive whole
quantity and derives `desigitem: '100-->#'` in the proposed request snapshot.
New Drive submissions cannot supply that derived designation. Persisted Eval
Work snapshots must match the same exact server derivation when revalidated.

The original `expected.desigitem` remains part of the source snapshot. Shearing
does not change the live inventory designation or season. Move Up, Move Down,
and sheared allocations share the current on-hand limit. Normal authorization,
source identity checks, revisions, and idempotency remain required.

Only requests containing a sheared proposal use V5. Other new requests, including
location-detail-only inquiries, retain V4. V3 and V4 requests remain readable and
deliverable. The additive migration adds
the V5 enqueue path and draft validation while keeping the existing workflow
boundaries. Deploy the database and backend handlers before publishing the PWA.
Rollback must retain V5 delivery support for requests already queued.

## Presentation and validation

The existing location cell displays one exact instruction per line, for example:

```text
700-->F1
200-->S1
100-->#
```

PDF rows grow with their content and stay together at page boundaries. Synthetic
browser coverage exercises long names, 35 locations, 105 instructions, and
multi-page output. It checks each instruction appears once, stays inside its
cell, and does not overlap. No test sends email or changes production inventory.

Focused checks cover typed proposals, active/disabled recipient precedence,
authorization, picker revision changes, and existing movement behavior. The
disposable SQL gate checks persisted designation, source conflicts, permissions,
quantity limits, duplicate submissions, old request versions, and generated
database contracts. Full release and production verification remain in Actions.
