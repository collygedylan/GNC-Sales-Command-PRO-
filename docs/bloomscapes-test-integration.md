# BloomScapes connected test demonstration

The Home AV tile and bottom Bloom view mount `v2/public/partner/nursery/` in a same-origin frame. It is the production build of the separate BloomScapes demonstration repository, reusing the pinned actual AV renderer and the same transactional sandbox API as storefront/retailer operations. It is not a production inventory connection.

- Nursery AV: `/v2/#partner-av`
- Nursery fulfillment: `/v2/#bloom`
- Customer: `https://bloomscapes-nursery-demo.fair-chick-6843.chatgpt.site/shop`
- Retailer: `https://bloomscapes-nursery-demo.fair-chick-6843.chatgpt.site/operations/`

Native demo membership is required. The pre-existing v2 placeholder profile never grants partner access, and no session is passed through the frame boundary. Demo credentials are private to Dylan, outside both repositories. Other v2 prototype views remain outside this partnership workflow. Payment and shipping are simulated; inventory reservations and all order transactions persist in sandbox project `apztnscvagayslumnalr`.

## Rebuilding the shared workspace

In the separate BloomScapes source checkout, run `npm run build:partner`, then `npm run export:partner -- <this checkout>/v2/public/partner`. The exporter requires the exact sandbox configuration and writes `bundle-provenance.json` containing SHA-256 file hashes. Do not hand-edit generated assets. `npm run build:v2` includes that exported workspace without a second implementation or backend copy.

The partner registers no service worker. The v2 worker excludes partner paths from precaching/navigation fallback and runs those paths network-only; its activation migration deletes exactly its former broad `gnc-v2-images` cache. The production root worker changes are limited to its URL/client/cache ownership boundaries, preserving v2 during activation, notifications and hidden-client updates. Root application release identity remains unchanged; v2 is `V2026.09.07.v2.17`.

## Verification and release

- `npm run test:v2`: AV and partner wrapper unit checks.
- `npm run test:photo`: photo regressions plus executable root-worker isolation assertions.
- `npm run test:pilot`: unchanged root application regression suite.
- `node --test v2/tests/cache-migration.test.mjs`: exact known-cache migration.
- `npx playwright test --config v2/tests/playwright.partner.config.ts`: four-device built-wrapper checks.
- `npx playwright test --config playwright.sw-isolation.config.ts`: real root-worker activation while v2 is open; uses the harmless root fixture served by the BloomScapes test server, not production application code.
- BloomScapes `playwright.integration.config.ts`: separate native sessions, full lifecycle, interrupted checkout, stale picking, mobile AV, cache/auth isolation and preservation of existing orders. This suite never resets the shared demo.

The existing Pages workflow publishes the v2 static assets and narrow root-worker update together. No deployment workflow, domain, production credentials or business data is changed. After deployment, verify both exact published origins with the non-reset integration suite and leave synthetic verification history intact. Do not run the older reset-based BloomScapes suites on this shared demonstration without explicit permission to discard its existing synthetic orders.
