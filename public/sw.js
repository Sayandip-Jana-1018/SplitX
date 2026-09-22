/*
 * SplitX service worker.
 *
 * It makes the app installable and shows an offline page when there is no
 * connection. It keeps nothing else: API responses are one person's money and
 * pages are rendered for whoever is signed in, so a cached copy could show
 * them to the next person using the phone.
 *
 * It replaces next-pwa, which was set up to keep API responses for 24 hours
 * but, being a webpack plugin, never produced a worker under Turbopack builds.
 * If a browser holds a worker from some other build, installing this one
 * deletes every cache it left behind.
 */

const OFFLINE_CACHE = 'splitx-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(OFFLINE_CACHE)
            .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name !== OFFLINE_CACHE).map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

// Page loads go to the network; only when it can't be reached is the offline
// page shown. Every other request is left alone.
self.addEventListener('fetch', (event) => {
    if (event.request.mode !== 'navigate') return;
    event.respondWith(
        fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
    );
});
