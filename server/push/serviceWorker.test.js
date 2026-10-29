import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../public/service-worker.js', import.meta.url), 'utf8')
const callId = 'c5a02bb0-cba1-4ad0-9e62-756a3fdd4615'

function createWorker(clients = []) {
  const handlers = new Map()
  const notifications = []
  const lifecycle = []
  const worker = {
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: async () => lifecycle.push('skipWaiting'),
    registration: {
      showNotification: async (title, options) => notifications.push({ title, options }),
      getNotifications: async () => notifications
        .filter((notification) => notification.options.tag === `incoming-call-${callId}`)
        .map((notification) => ({ close: () => notifications.splice(notifications.indexOf(notification), 1) })),
    },
    clients: {
      matchAll: async () => clients,
      openWindow: async (url) => ({ url }),
      claim: async () => lifecycle.push('claim'),
    },
    location: { origin: 'https://sonrisetalk.example' },
  }
  runInNewContext(source, { self: worker, URL })
  return { handlers, notifications, worker, lifecycle }
}

test('service worker activation takes control of the current application page', async () => {
  const { handlers, lifecycle } = createWorker()
  let completion
  handlers.get('activate')({ waitUntil: (promise) => { completion = promise } })
  await completion
  assert.deepEqual(lifecycle, ['claim'])
})

function dispatchPush(handlers, payload) {
  let completion
  handlers.get('push')({
    data: { json: () => payload },
    waitUntil: (promise) => { completion = promise },
  })
  return completion
}

test('service worker shows only valid incoming-call push payloads without duplicate alerts', async () => {
  const { handlers, notifications } = createWorker()
  await dispatchPush(handlers, {
    type: 'incoming-call',
    callId,
    title: 'Alex is calling',
    body: 'Group incoming voice call',
  })

  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].options.tag, `incoming-call-${callId}`)
  assert.equal(notifications[0].options.renotify, false)
  assert.deepEqual(JSON.parse(JSON.stringify(notifications[0].options.data)), { callId, url: '/' })
})

test('service worker ignores malformed push payloads and calls while the app is visible', async () => {
  const visibleClient = { visibilityState: 'visible' }
  const { handlers, notifications } = createWorker([visibleClient])
  await dispatchPush(handlers, {
    type: 'incoming-call',
    callId,
    title: 'Alex is calling',
    body: 'Group incoming voice call',
  })
  await dispatchPush(handlers, { title: 'untrusted payload' })

  assert.equal(notifications.length, 0)
})

test('notification clicks open the app root and focus an existing same-origin window', async () => {
  const actions = []
  const client = {
    url: 'https://sonrisetalk.example/messages',
    navigate: async (url) => actions.push(['navigate', url]),
    focus: async () => actions.push(['focus']),
  }
  const { handlers } = createWorker([client])
  let completion
  handlers.get('notificationclick')({
    notification: {
      data: { callId, url: '/' },
      close: () => actions.push(['close']),
    },
    waitUntil: (promise) => { completion = promise },
  })
  await completion

  assert.deepEqual(actions, [
    ['close'],
    ['navigate', 'https://sonrisetalk.example/'],
    ['focus'],
  ])
})

test('service worker closes an incoming-call alert when the call ends', async () => {
  const { handlers, notifications } = createWorker()
  await dispatchPush(handlers, {
    type: 'incoming-call',
    callId,
    title: 'Alex is calling',
    body: 'Group incoming voice call',
  })

  let completion
  handlers.get('message')({
    data: { type: 'CALL_ENDED', callId },
    waitUntil: (promise) => { completion = promise },
  })
  await completion

  assert.equal(notifications.length, 0)
})
