const CACHE_NAME = 'arkonomy-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// Install — cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Push notifications ────────────────────────────────────────────────────────
// Triggered by the push-notify Supabase Edge Function.
// Payload shape: { title, body, icon?, tag?, url? }
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Arkonomy', body: event.data.text() };
  }

  const { title = 'Arkonomy', body = '', icon, tag, url } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:      icon || '/icon-192.png',
      badge:     '/icon-192.png',
      tag:       tag || 'arkonomy-reminder',
      renotify:  true,
      vibrate:   [200, 100, 200],
      data:      { url: url || '/' },
    })
  );
});

// Open app on notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus existing window if open
      for (const client of list) {
        if (client.url === self.location.origin + '/' && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return clients.openWindow(event.notification.data?.url || '/');
    })
  );
});

// Matches the request's hostname exactly or as a subdomain of an allowed
// domain — url.includes(domain) would also match an untrusted host that
// merely contains the domain as a substring (e.g. "supabase.co.evil.com").
function isTrustedHost(url, domains) {
  try {
    const hostname = new URL(url).hostname;
    return domains.some(d => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// ── Fetch — network first, fallback to cache ──────────────────────────────────
self.addEventListener('fetch', event => {
  // Skip non-GET and Supabase API calls
  if (event.request.method !== 'GET') return;
  if (isTrustedHost(event.request.url, ['supabase.co'])) return;
  if (isTrustedHost(event.request.url, ['finnhub.io'])) return;
  // Plaid Link's script (cdn.plaid.com/link/v2/stable/link-initialize.js) was
  // getting intercepted and failing here — confirmed live: every new user's
  // first "Connect Your Bank" attempt got stuck on a synthetic 504 from the
  // catch() below instead of the real script. Matches any plaid.com
  // subdomain, not just cdn., in case Link's own runtime fetches others.
  if (isTrustedHost(event.request.url, ['plaid.com'])) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached =>
          cached || new Response('', { status: 504, statusText: 'Network error' })
        )
      )
  );
});
