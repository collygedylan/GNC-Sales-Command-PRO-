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
        vibrate: [200, 100, 200] // Distinctive buzz pattern for the field
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
        clients.matchAll({ type: 'window' }).then(function(clientList) {
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
