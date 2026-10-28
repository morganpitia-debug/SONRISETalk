import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024
const SERVICE_TIMEOUT_MS = 60_000

function getEncryptionKey() {
  const encoded = process.env.FACE_RECOVERY_ENCRYPTION_KEY
  const key = encoded ? Buffer.from(encoded, 'base64') : null
  if (!key || key.length !== 32) {
    const error = new Error('Face recovery is not configured.')
    error.status = 503
    error.code = 'FACE_RECOVERY_UNAVAILABLE'
    throw error
  }
  return key
}

function serviceConfiguration() {
  const configuredUrl = process.env.FACE_VERIFICATION_SERVICE_URL
  const serviceToken = process.env.FACE_VERIFICATION_SERVICE_TOKEN
  let serviceUrl
  try {
    const parsedUrl = new URL(configuredUrl)
    const localOrPrivate = ['localhost', '127.0.0.1'].includes(parsedUrl.hostname)
      || parsedUrl.hostname.endsWith('.internal')
    if ((parsedUrl.protocol !== 'https:' && !localOrPrivate) || parsedUrl.username || parsedUrl.password) {
      throw new Error('Unsupported face service URL.')
    }
    serviceUrl = parsedUrl.origin
  } catch {
    serviceUrl = null
  }
  if (!serviceUrl || !serviceToken || serviceToken.length < 32) {
    const error = new Error('Face recovery is not configured.')
    error.status = 503
    error.code = 'FACE_RECOVERY_UNAVAILABLE'
    throw error
  }
  return { serviceUrl, serviceToken }
}

export function isFaceRecoveryConfigured() {
  const key = process.env.FACE_RECOVERY_ENCRYPTION_KEY
    ? Buffer.from(process.env.FACE_RECOVERY_ENCRYPTION_KEY, 'base64')
    : null
  let validServiceUrl = false
  try {
    const parsedUrl = new URL(process.env.FACE_VERIFICATION_SERVICE_URL)
    const localOrPrivate = ['localhost', '127.0.0.1'].includes(parsedUrl.hostname)
      || parsedUrl.hostname.endsWith('.internal')
    validServiceUrl = (parsedUrl.protocol === 'https:' || localOrPrivate)
      && !parsedUrl.username
      && !parsedUrl.password
  } catch {
    validServiceUrl = false
  }
  return Boolean(
    key?.length === 32
    && validServiceUrl
    && process.env.FACE_VERIFICATION_SERVICE_TOKEN?.length >= 32,
  )
}

export function encryptFaceReference(image) {
  const initializationVector = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), initializationVector)
  const encryptedReference = Buffer.concat([cipher.update(image), cipher.final()])
  return {
    encryptedReference,
    initializationVector,
    authenticationTag: cipher.getAuthTag(),
  }
}

export function decryptFaceReference(enrollment) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    enrollment.initializationVector,
  )
  decipher.setAuthTag(enrollment.authenticationTag)
  return Buffer.concat([
    decipher.update(enrollment.encryptedReference),
    decipher.final(),
  ])
}

export async function verifyFaceFrame({ userId, reference, frame }) {
  if (reference.length > IMAGE_LIMIT_BYTES || frame.length > IMAGE_LIMIT_BYTES) {
    reference.fill(0)
    frame.fill(0)
    const error = new Error('Choose a smaller face image and try again.')
    error.status = 413
    error.code = 'FACE_IMAGE_TOO_LARGE'
    throw error
  }

  try {
    const { serviceUrl, serviceToken } = serviceConfiguration()
    const payload = new FormData()
    payload.set('user_id', userId)
    payload.set('reference', new Blob([reference], { type: 'image/jpeg' }), 'reference.jpg')
    payload.set('frame', new Blob([frame], { type: 'image/jpeg' }), 'capture.jpg')
    const response = await fetch(`${serviceUrl}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceToken}` },
      body: payload,
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    })
    if (!response.ok) {
      const error = new Error('Face verification is temporarily unavailable. Try passkey recovery instead.')
      error.status = 503
      error.code = 'FACE_VERIFICATION_UNAVAILABLE'
      throw error
    }

    const result = await response.json()
    return result.verified === true
  } catch (cause) {
    if (cause.status) throw cause
    const error = new Error('Face verification is temporarily unavailable. Try passkey recovery instead.', { cause })
    error.status = 503
    error.code = 'FACE_VERIFICATION_UNAVAILABLE'
    throw error
  } finally {
    reference.fill(0)
    frame.fill(0)
  }
}
