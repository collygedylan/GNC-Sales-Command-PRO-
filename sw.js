/* GREENLEAF PROFESSIONAL SERVICE WORKER
  Optimized for: Instant Load, Offline Stability, and Push Notifications
*/

const CACHE_NAME = 'greenleaf-v3.5'; // Increment this whenever you push big UI changes

// Assets to store in the phone's local memory
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/@phosphor-icons/web',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// 1. INSTALL: Save the app structure to the device
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Pre-caching App Shell');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// 2. ACTIVATE: Clean up old versions so the app stays fast
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[Service Worker] Removing old cache', key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// 3. FETCH: The Speed Engine. 
// Serves files from cache instantly while checking for updates in the background.
self.addEventListener('fetch', (event) => {
    // Only intercept standard GET requests (don't cache DB updates)
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((cachedResponse) => {
                const fetchedResponse = fetch(event.request).then((networkResponse) => {
                    // Update the cache with the newest version for next time
                    if (networkResponse.status === 200) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                }).catch(() => {
                    // If network fails, we already returned cachedResponse
                });

                // Return the cached version immediately (Amazon Speed), 
                // or wait for network if not in cache.
                return cachedResponse || fetchedResponse;
            });
        })
    );
});


/* --- PUSH NOTIFICATION LOGIC --- */

// Listen for background push signals sent from your Supabase database
self.addEventListener('push', function(event) {
    let data = {};
    
    // Parse the data sent from your database
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { title: "New Message", body: event.data.text() };
        }
    }

    const title = data.title || "Greenleaf Message";
    const options = {
        body: data.body || "You have a new message.",
        icon: '/icon.png', // Ensure you have a 192x192 or 512x512 icon.png in your root folder
        badge: '/icon.png',
        data: { url: '/' }, // Where to send the user when they tap the alert
        vibrate: [200, 100, 200], // Distinctive buzz pattern for the field
        tag: 'greenleaf-alert', // Prevents multiple notifications from flooding the screen
        renotify: true
    };

    // Tell the phone's operating system to show the notification
    event.waitUntil(self.registration.showNotification(title, options));
});

// What happens when the user taps the notification on their lock screen
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // This looks to see if the app is already open in the background and brings it to the front. 
    // If it's completely closed, it opens a fresh window.
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (var i = 0; i < clientList.length; i++) {
                var client = clientList[i];
                if (client.url.indexOf('/') !== -1 && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
