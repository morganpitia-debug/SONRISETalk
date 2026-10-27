const MAX_ENDPOINT_LENGTH = 2048
const PUSH_ENDPOINT_HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
]

export function isAllowedPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > MAX_ENDPOINT_LENGTH) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (!url.port || url.port === '443')
      && PUSH_ENDPOINT_HOSTS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}
