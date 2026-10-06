/* Winglet service worker: keeps the app shell for offline use, shows push notifications, handles taps. */
const SHELL = 'winglet-shell-v1';
const HASHED = /^\/(_expo\/static|assets)\//;

/** Cache the page and every bundle it references, dropping bundles from older builds. */
async function cacheShell(response) {
  const cache = await caches.open(SHELL);
  const html = await response.clone().text();
  await cache.put('/', response.clone());
  const refs = new Set([...html.matchAll(/(?:src|href)="(\/(?:_expo\/static|icons)\/[^"]+)"/g)].map((m) => m[1]));
  await Promise.all([...refs].map((ref) => cache.match(ref).then((hit) => hit || cache.add(ref).catch(() => undefined))));
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/_expo/static/') && !refs.has(path)) await cache.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(fetch('/', { cache: 'no-store' }).then((r) => (r.ok ? cacheShell(r) : undefined)).catch(() => undefined)
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // The API is never cached: it's live data, and responses can be private to this device.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    // Network first so updates arrive at once; the cached shell opens the app when the server is down.
    event.respondWith(fetch(request).then((response) => {
      if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
        event.waitUntil(cacheShell(response.clone()).catch(() => undefined));
      }
      return response;
    }).catch(() => caches.match('/').then((hit) => hit || Response.error())));
    return;
  }
  const keep = (response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL).then((cache) => cache.put(request, copy)));
    }
    return response;
  };
  if (HASHED.test(url.pathname)) {
    // Bundles and fonts are content-hashed, so a cached copy is always the right one.
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then(keep)));
  } else if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(fetch(request).then(keep).catch(() => caches.match(request).then((hit) => hit || Response.error())));
  }
});

self.addEventListener('push', (event) => {
  let note = {};
  try {
    note = event.data ? event.data.json() : {};
  } catch (e) {
    note = { title: 'Winglet', body: event.data ? event.data.text() : '' };
  }
  const options = {
    body: note.body || '',
    tag: note.tag,
    renotify: !!note.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: note,
    requireInteraction: note.kind === 'approval' || note.kind === 'question',
    actions: (note.actions || []).map((a) => ({ action: a.action, title: a.title })),
  };
  event.waitUntil(self.registration.showNotification(note.title || 'Winglet', options));
});

self.addEventListener('notificationclick', (event) => {
  const note = event.notification.data || {};
  event.notification.close();
  const action = (note.actions || []).find((a) => a.action === event.action);
  if (action && note.item_id) {
    // One-tap approve/deny straight from the notification (signed by the server, no token needed).
    const url = `/api/inbox/${encodeURIComponent(note.item_id)}/respond?choice=${encodeURIComponent(action.action)}&sig=${encodeURIComponent(action.sig)}`;
    event.waitUntil(fetch(url, { method: 'POST' }).catch(() => undefined));
    return;
  }
  const target = note.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
