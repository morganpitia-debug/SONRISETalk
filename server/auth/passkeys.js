const LOCAL_ORIGINS = ['http://localhost:5173', 'http://localhost:4173']

export function getWebAuthnConfig(origin) {
  if (typeof origin !== 'string' || !origin) return null

  const configuredOrigins = process.env.WEBAUTHN_ORIGINS
    || process.env.CLIENT_ORIGINS
    || LOCAL_ORIGINS.join(',')
  const allowedOrigins = configuredOrigins.split(',').map((value) => {
    try {
      const url = new URL(value.trim())
      if (url.origin !== value.trim() || !['https:', 'http:'].includes(url.protocol)) return null
      if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null
      return url.origin
    } catch {
      return null
    }
  }).filter(Boolean)

  if (!allowedOrigins.includes(origin)) return null

  const parsedOrigin = new URL(origin)
  return {
    expectedOrigin: parsedOrigin.origin,
    rpID: parsedOrigin.hostname,
  }
}

export function createChallengeExpiry(now = Date.now()) {
  return new Date(now + 5 * 60 * 1000)
}
