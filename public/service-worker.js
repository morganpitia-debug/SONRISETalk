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
    const isCall = payload?.type === 'incoming-call'
      && typeof payload.data?.callId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.data.callId)
    const isMessage = payload?.type === 'incoming-message'
      && typeof payload.data?.conversationId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.data.conversationId)
    if ((!isCall && !isMessage)
      || typeof payload.title !== 'string'
      || payload.title.length > 100
      || typeof payload.body !== 'string'
      || payload.body.length > 140) return

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.some((client) => client.visibilityState === 'visible')) return

    const id = isCall ? payload.data.callId : payload.data.conversationId
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png?v=4',
      badge: '/icon-192.png?v=4',
      tag: `${isCall ? 'incoming-call' : 'incoming-message'}-${id}`,
      renotify: false,
      data: isCall
        ? { callId: id, url: `/?incomingCallId=${encodeURIComponent(id)}` }
        : { conversationId: id, url: `/?conversationId=${encodeURIComponent(id)}` },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const notificationData = event.notification.data
  const isCall = typeof notificationData?.callId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationData.callId)
  const isMessage = typeof notificationData?.conversationId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationData.conversationId)
  if (!isCall && !isMessage) return
  const targetUrl = new URL('/', self.location.origin)
  targetUrl.searchParams.set(isCall ? 'incomingCallId' : 'conversationId', isCall ? notificationData.callId : notificationData.conversationId)
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
