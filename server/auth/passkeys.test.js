import test from 'node:test'
import assert from 'node:assert/strict'
import { createChallengeExpiry, getWebAuthnConfig } from './passkeys.js'

test('WebAuthn accepts a configured local app origin', () => {
  const previous = process.env.CLIENT_ORIGINS
  const previousWebAuthnOrigins = process.env.WEBAUTHN_ORIGINS
  process.env.CLIENT_ORIGINS = 'http://localhost:5173,http://localhost:4173'
  delete process.env.WEBAUTHN_ORIGINS

  try {
    assert.deepEqual(getWebAuthnConfig('http://localhost:5173'), {
      expectedOrigin: 'http://localhost:5173',
      rpID: 'localhost',
    })
  } finally {
    if (previous === undefined) delete process.env.CLIENT_ORIGINS
    else process.env.CLIENT_ORIGINS = previous
    if (previousWebAuthnOrigins === undefined) delete process.env.WEBAUTHN_ORIGINS
    else process.env.WEBAUTHN_ORIGINS = previousWebAuthnOrigins
  }
})

test('WebAuthn rejects an unconfigured origin and insecure non-local origin', () => {
  const previous = process.env.WEBAUTHN_ORIGINS
  process.env.WEBAUTHN_ORIGINS = 'https://sonrisetalk.example.com,http://untrusted.example.com'

  try {
    assert.equal(getWebAuthnConfig('https://attacker.example.com'), null)
    assert.equal(getWebAuthnConfig('http://untrusted.example.com'), null)
    assert.deepEqual(getWebAuthnConfig('https://sonrisetalk.example.com'), {
      expectedOrigin: 'https://sonrisetalk.example.com',
      rpID: 'sonrisetalk.example.com',
    })
  } finally {
    if (previous === undefined) delete process.env.WEBAUTHN_ORIGINS
    else process.env.WEBAUTHN_ORIGINS = previous
  }
})

test('passkey ceremonies expire after five minutes', () => {
  assert.equal(createChallengeExpiry(1000).getTime(), 301000)
})
