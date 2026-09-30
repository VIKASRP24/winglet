/* Winglet service worker: shows push notifications and handles taps on them. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
