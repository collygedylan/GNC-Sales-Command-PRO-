/* Retire only v2's obsolete broad image cache. Never enumerate or delete other caches. */
self.addEventListener('activate', event => {
  event.waitUntil(caches.delete('gnc-v2-images'));
});
