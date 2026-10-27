self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = { title: 'Incoming call', body: 'Open SONRISETALK to answer.' }
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'Incoming call', {
    body: payload.body || 'Open SONRISETALK to answer.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'sonrisetalk-incoming-call',
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [250, 100, 250, 100, 500],
    data: payload.data || { url: '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(targetUrl)
        return client.focus()
      }
    }
    return self.clients.openWindow(targetUrl)
  })())
})
