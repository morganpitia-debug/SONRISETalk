import { createECDH } from 'node:crypto'

const VAPID_ENVIRONMENT_VARIABLES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']

function isValidSubject(subject) {
  if (typeof subject !== 'string') return false
  if (subject.startsWith('mailto:')) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject.slice('mailto:'.length))
  }
  try {
    const url = new URL(subject)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

function getVapidKeyPairStatus(publicKey, privateKey) {
  if (!publicKey || !privateKey || !/^[A-Za-z0-9_-]+$/.test(publicKey) || !/^[A-Za-z0-9_-]+$/.test(privateKey)) {
    return 'invalid'
  }
  try {
    const publicBytes = Buffer.from(publicKey, 'base64url')
    const privateBytes = Buffer.from(privateKey, 'base64url')
    if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) return 'invalid'
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(privateBytes)
    return ecdh.getPublicKey(undefined, 'uncompressed').equals(publicBytes) ? null : 'mismatch'
  } catch {
    return 'invalid'
  }
}

export function getPushConfiguration() {
  const values = VAPID_ENVIRONMENT_VARIABLES.map((name) => process.env[name]?.trim() || '')
  const [publicKey, privateKey, subject] = values
  const missing = VAPID_ENVIRONMENT_VARIABLES.filter((_, index) => !values[index])
  let reason = null
  if (missing.length) {
    reason = 'missing'
  } else {
    reason = getVapidKeyPairStatus(publicKey, privateKey)
      || (isValidSubject(subject) ? null : 'invalid_subject')
  }
  return {
    configured: reason === null,
    publicKey: reason === null ? publicKey : null,
    ...(reason ? { reason } : {}),
  }
}

export function getPushConfigurationDiagnostic(configuration = getPushConfiguration()) {
  if (configuration.configured) return null
  if (configuration.reason === 'missing') {
    return 'Web Push is disabled: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT in the server environment.'
  }
  if (configuration.reason === 'mismatch') {
    return 'Web Push is disabled: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must come from the same key pair.'
  }
  if (configuration.reason === 'invalid_subject') {
    return 'Web Push is disabled: VAPID_SUBJECT must be a valid mailto: or HTTPS contact URI.'
  }
  return 'Web Push is disabled: the VAPID key format is invalid. Generate a matching key pair and configure both keys.'
}
