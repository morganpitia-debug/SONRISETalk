import { request } from './auth.js'

export function getPushConfiguration() {
  return request('/api/push/config').then((response) => response.data)
}

export function getPushSubscriptions() {
  return request('/api/push/subscriptions').then((response) => response.data)
}

export function savePushSubscription(subscription) {
  return request('/api/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription }),
  }).then((response) => response.data)
}

export function deletePushSubscription(endpoint) {
  return request('/api/push/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  })
}

export function registerServiceWorker() {
  return navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
}
