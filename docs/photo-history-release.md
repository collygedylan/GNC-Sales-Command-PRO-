# Dylan-only Photo History — V2026.09.04.05

Entry: **Sales → Photo History**, visible only to Dylan. The authenticated App API independently resolves the active profile; the service-only RPC checks `dylan_collyge` again. No browser access to catalog, delivery records or arbitrary Storage paths is granted.

## Behavior

- Search Common Name, ITEMCODE or original filename; optional exact container/location/lot and inclusive date filters.
- One card per original object, enriched from inventory, Request history, Flyer history and productivity snapshots. The same photo reused in several records is deduplicated by bucket/path. Unlabeled originals remain searchable by filename. Metadata is indexed, not copied media.
- Keyset pages arrive automatically as the user scrolls. Only near-screen thumbnails are hydrated; DOM rendering is windowed. V2 uploads use static sidecars; legacy photos use 320 px transforms. Failed previews never download originals. Full original resolution is explicit through Open Photo. Verified Drive-only archives use protected previews and an explicit original Drive link.
- Selections survive searches and modal navigation. Up to 20 selections, one verified active sales rep, optional message. One outbox event and one email with separate, numbered image attachments. Historical disclaimer, stored dates, original filenames, plant labels and locations accompany attachments. No current quality/availability is implied.
- Send commits only authoritative asset IDs/recipient profile, actor from session, and frozen metadata/recipient address. Pending network retries retain their token and packet. The server rejects token reuse with different content. Delivered events cannot be retried. Only terminal delivery notices are displayed and remain until dismissed.
- Existing scheduled maintenance refreshes the metadata index at most every 15 minutes. It uses a nonblocking lock and avoids no-op catalog writes. This does not extend photo retention or modify archive lifecycle rules.

## Deployment / checks

1. Append-only catalog/RPC migrations, then metadata-only dry run and initial index.
2. Protected App API and existing email worker updates.
3. Signed Apps Script thumbnail and email handler.
4. Synchronized .05 shell, manifest and service worker.

Initial production index: 18,984 references, 15,094 with recorded Common Name, including seven verified Drive-only archives. Three Lemon Grass 1GP photos for ITEMCODE 004740.013.1, location D.07.032, stored June 4, 2026 were found through Common Name search.

Tests: `npm run test:photo`, `npm run test:pilot`, `npx playwright test`, `npm run check:inline`, `npm run build:live`, `npm run build:v2`. New pgTAP grants checks are included in hosted isolated-DB performance tests. `supabase/tests/photo_history_rollback_canary.sql` verifies production contracts inside an explicit rollback; no delivery event is committed or email sent.

The monolithic App API already has 31 Deno type errors on the unchanged .04 baseline. The same 31 remain; the new helper and email worker pass Deno checks. This release does not modify unrelated Request evidence data or mask the pre-existing production Request/evidence health incident.
