import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const turnUrls = (process.env.TURN_URLS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean)
const turnSharedSecret = process.env.TURN_SHARED_SECRET?.trim()
const credentialLifetimeSeconds = Number(process.env.TURN_CREDENTIAL_LIFETIME_SECONDS || 3600)

if (turnUrls.length && !turnSharedSecret) {
  throw new Error('TURN_SHARED_SECRET is required when TURN_URLS is configured.')
}
if (!Number.isInteger(credentialLifetimeSeconds) || credentialLifetimeSeconds < 60) {
  throw new Error('TURN_CREDENTIAL_LIFETIME_SECONDS must be an integer of at least 60.')
}

export const config = {
  stunUrls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
  turn: turnUrls.length
    ? { urls: turnUrls, sharedSecret: turnSharedSecret, credentialLifetimeSeconds }
    : null,
}
