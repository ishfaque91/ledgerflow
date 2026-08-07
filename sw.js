/**
 * TeleFlow — service worker for the main app.
 * Exists to satisfy PWA installability and give the static app shell (HTML/
 * CSS/JS) basic offline resilience. Firestore/Auth traffic goes straight to
 * Google's servers over its own connection and is never touched here — this
 * only ever intercepts same-origin GET requests.
 */
const CACHE_NAME = 'teleflow-shell-v14';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/firebase-config.js',
    './js/utils.js',
    './js/db.js',
    './js/app.js',
    './js/accounts.js',
    './js/items.js',
    './js/users.js',
    './js/rights.js',
    './js/rso.js',
    './js/sim-activation.js',
    './js/integrity.js',
    './js/dataentry.js',
    './js/vouchers.js',
    './js/reports.js',
    './js/reports-financial.js',
    './js/reports-graphs.js',
    './js/utility.js',
    './js/tools.js',
    './js/export.js',
    './js/auth.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Network-first, falling back to the cached shell when offline — so the
// app opens even without a connection, while normal use always gets the
// freshest files instead of stale cached ones.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
