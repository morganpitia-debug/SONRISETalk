self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload
    try {
      payload = event.data?.json()
    } catch {
      return
    }
    if (payload?.type !== 'incoming-call'
      || typeof payload.data?.callId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.data.callId)
      || typeof payload.title !== 'string'
      || payload.title.length > 100
      || typeof payload.body !== 'string'
      || payload.body.length > 140) return

    const callId = payload.data.callId
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.some((client) => client.visibilityState === 'visible')) return

    await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png?v=4',
      badge: '/icon-192.png?v=4',
      tag: `incoming-call-${callId}`,
      renotify: false,
      data: { callId, url: `/?incomingCallId=${encodeURIComponent(callId)}` },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const notificationData = event.notification.data
  if (typeof notificationData?.callId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationData.callId)) return
  const targetUrl = new URL('/', self.location.origin)
  targetUrl.searchParams.set('incomingCallId', notificationData.callId)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(targetUrl.href)
        return client.focus()
      }
    }
    return self.clients.openWindow(targetUrl.href)
  })())
})

self.addEventListener('message', (event) => {
  const message = event.data
  if (message?.type !== 'CALL_ENDED'
    || typeof message.callId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.callId)) return

  event.waitUntil(self.registration.getNotifications({ tag: `incoming-call-${message.callId}` })
    .then((notifications) => notifications.forEach((notification) => notification.close())))
})
