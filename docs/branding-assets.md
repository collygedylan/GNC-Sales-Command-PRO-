# Branding assets

`assets/branding/catalog.json` is the source of truth for the production logos,
app icons, and splash image. Each entry records the canonical file, its SHA-256
digest and byte count, and the older root-level filenames that still need to
resolve.

The catalog keeps nine unique image payloads (1,456,461 bytes). Thirty historic
filenames remain available as generated aliases for existing shell markup,
manifests, notifications, and installed PWA caches. The aliases represent
10,282,691 bytes of duplicated payload before consolidation. The catalog
reduces tracked image bytes by 8,826,230 bytes; release output still contains
generated aliases, so this is repository storage savings, not a published
deployment-size reduction.

## Build and offline behavior

The release asset preparation validates each canonical file against its
catalog digest and size, materializes the legacy root aliases, and synchronizes
the worker's branding asset list. Keep legacy URLs in the catalog until old
installed shells and service-worker caches no longer depend on them. New
references should use the canonical paths.

The browser regression uses a temporary local fixture. Chromium and WebKit
verify canonical and legacy image URLs and manifest icons. Chromium also
checks fresh-install offline caching and that an old root URL still works
offline after the worker updates. Playwright supports service-worker
automation in Chromium; worker cache isolation and alias-routing behavior are
also covered by the service-worker unit tests.

This is a storage and delivery cleanup only: it preserves the existing brand
art, root URL compatibility, application behavior, historical SQL and audit
data, UI assets, and all 19 release workflows. Those workflows retain their
separate triggers, reusable workflow entry points, manual operations, and
active automation. The browser validation job now installs WebKit alongside
Chromium for the catalog image smoke checks. The request-archive browser cases
remain part of the release-functional suite; only their unused one-off
Playwright config was removed.
