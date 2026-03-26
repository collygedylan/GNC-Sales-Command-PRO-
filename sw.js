/* GREENLEAF PROFESSIONAL SERVICE WORKER
  Optimized for: Instant Load, Offline Stability, Push Notifications, and AGGRESSIVE UPDATES
*/

// BUMP THIS VERSION slightly (e.g., v3.6) to trigger the first massive update for all devices
const CACHE_NAME = 'greenleaf-v3.6'; 

// Assets to store in the phone's local memory
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/@phosphor-icons/web',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// 1. INSTALL: Save the app structure and forcefully skip the waiting phase
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Pre-caching App Shell');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    // Force the new code to install immediately
    self.skipWaiting();
});

// 2. ACTIVATE: Clean up old versions and immediately claim control of the screen
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
        }).then(() => {
            // Take immediate control of all open windows/tabs to trigger the reload
            return self.clients.claim();
        })
    );
});

// 3. FETCH: The Aggressive Speed Engine (Network-First Strategy)
// Always checks GitHub for the newest code first. Falls back to cache ONLY if offline.
self.addEventListener('fetch', (event) => {
    // Only intercept standard GET requests
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            // If network is successful, update the cache with the newest version
            if (networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
            }
            return networkResponse;
        }).catch(() => {
            // If network fails (offline in the field), pull the backup from the cache
            return caches.match(event.request);
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
