import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import {
  decryptFaceReference,
  encryptFaceReference,
  isFaceRecoveryConfigured,
  verifyFaceFrame,
} from './faceRecovery.js'

test('face references are authenticated-encrypted and reject tampering', () => {
  const previousKey = process.env.FACE_RECOVERY_ENCRYPTION_KEY
  process.env.FACE_RECOVERY_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  const reference = Buffer.from('private face image')

  try {
    const encrypted = encryptFaceReference(reference)
    assert.deepEqual(decryptFaceReference(encrypted), reference)
    encrypted.authenticationTag[0] ^= 0xff
    assert.throws(() => decryptFaceReference(encrypted))
  } finally {
    if (previousKey === undefined) delete process.env.FACE_RECOVERY_ENCRYPTION_KEY
    else process.env.FACE_RECOVERY_ENCRYPTION_KEY = previousKey
  }
})

test('face verification sends the user reference to the private service and clears image buffers', async () => {
  const previousUrl = process.env.FACE_VERIFICATION_SERVICE_URL
  const previousToken = process.env.FACE_VERIFICATION_SERVICE_TOKEN
  const previousFetch = globalThis.fetch
  const reference = Buffer.from('reference image')
  const frame = Buffer.from('captured image')
  process.env.FACE_VERIFICATION_SERVICE_URL = 'http://127.0.0.1:8000/'
  process.env.FACE_VERIFICATION_SERVICE_TOKEN = 'x'.repeat(40)

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/verify')
    assert.equal(options.headers.Authorization, `Bearer ${process.env.FACE_VERIFICATION_SERVICE_TOKEN}`)
    assert.equal(options.body.get('user_id'), 'account-id')
    assert.equal(options.body.get('reference').type, 'image/jpeg')
    assert.equal(options.body.get('frame').type, 'image/jpeg')
    return new Response(JSON.stringify({ verified: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    assert.equal(await verifyFaceFrame({ userId: 'account-id', reference, frame }), true)
    assert.deepEqual(reference, Buffer.alloc(reference.length))
    assert.deepEqual(frame, Buffer.alloc(frame.length))
  } finally {
    globalThis.fetch = previousFetch
    if (previousUrl === undefined) delete process.env.FACE_VERIFICATION_SERVICE_URL
    else process.env.FACE_VERIFICATION_SERVICE_URL = previousUrl
    if (previousToken === undefined) delete process.env.FACE_VERIFICATION_SERVICE_TOKEN
    else process.env.FACE_VERIFICATION_SERVICE_TOKEN = previousToken
  }
})

test('face verification fails explicitly and clears the reference when unconfigured', async () => {
  const previousUrl = process.env.FACE_VERIFICATION_SERVICE_URL
  const previousToken = process.env.FACE_VERIFICATION_SERVICE_TOKEN
  delete process.env.FACE_VERIFICATION_SERVICE_URL
  delete process.env.FACE_VERIFICATION_SERVICE_TOKEN
  const reference = Buffer.from('reference image')

  try {
    await assert.rejects(
      verifyFaceFrame({ userId: 'account-id', reference, frame: Buffer.from('capture') }),
      (error) => error.code === 'FACE_RECOVERY_UNAVAILABLE' && error.status === 503,
    )
    assert.deepEqual(reference, Buffer.alloc(reference.length))
  } finally {
    if (previousUrl === undefined) delete process.env.FACE_VERIFICATION_SERVICE_URL
    else process.env.FACE_VERIFICATION_SERVICE_URL = previousUrl
    if (previousToken === undefined) delete process.env.FACE_VERIFICATION_SERVICE_TOKEN
    else process.env.FACE_VERIFICATION_SERVICE_TOKEN = previousToken
  }
})

test('face recovery only accepts HTTPS or trusted local/private service URLs', () => {
  const previousKey = process.env.FACE_RECOVERY_ENCRYPTION_KEY
  const previousUrl = process.env.FACE_VERIFICATION_SERVICE_URL
  const previousToken = process.env.FACE_VERIFICATION_SERVICE_TOKEN
  process.env.FACE_RECOVERY_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  process.env.FACE_VERIFICATION_SERVICE_TOKEN = 'x'.repeat(40)

  try {
    process.env.FACE_VERIFICATION_SERVICE_URL = 'http://127.0.0.1:8000'
    assert.equal(isFaceRecoveryConfigured(), true)
    process.env.FACE_VERIFICATION_SERVICE_URL = 'http://public.example.com'
    assert.equal(isFaceRecoveryConfigured(), false)
    process.env.FACE_VERIFICATION_SERVICE_URL = 'https://public.example.com'
    assert.equal(isFaceRecoveryConfigured(), true)
  } finally {
    if (previousKey === undefined) delete process.env.FACE_RECOVERY_ENCRYPTION_KEY
    else process.env.FACE_RECOVERY_ENCRYPTION_KEY = previousKey
    if (previousUrl === undefined) delete process.env.FACE_VERIFICATION_SERVICE_URL
    else process.env.FACE_VERIFICATION_SERVICE_URL = previousUrl
    if (previousToken === undefined) delete process.env.FACE_VERIFICATION_SERVICE_TOKEN
    else process.env.FACE_VERIFICATION_SERVICE_TOKEN = previousToken
  }
})
