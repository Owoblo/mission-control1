// Saturn Star OS — Service Worker
// Keeps the app alive in the background so the dialer never misses a call.

const CACHE = 'saturn-star-v1'

// Pages to pre-cache for instant load
const PRECACHE = [
  '/sales/pipeline',
  '/sales/inbox',
  '/sales/operations',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Network-first for API calls, cache-first for static assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  // Always network for API routes
  if (url.pathname.startsWith('/api/')) return

  // Cache-first for static assets
  if (event.request.destination === 'image' || event.request.destination === 'font') {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    )
    return
  }

  // Network-first for pages (always fresh data)
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})

// Push notifications — incoming call alerts
self.addEventListener('push', event => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title || 'Saturn Star OS', {
      body: data.body || 'New activity',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'saturn-star',
      requireInteraction: data.requireInteraction || false,
      data: { url: data.url || '/sales/pipeline' },
    })
  )
})

// Click notification → open the app
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/sales/pipeline'
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      const existing = clients.find(c => c.url.includes(targetUrl))
      if (existing) return existing.focus()
      return self.clients.openWindow(targetUrl)
    })
  )
})
