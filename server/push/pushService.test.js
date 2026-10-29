import assert from 'node:assert/strict'
import test from 'node:test'
import webpush from 'web-push'
import { getPushConfiguration, getPushConfigurationDiagnostic } from './pushConfig.js'
import { isAllowedPushEndpoint } from './pushValidation.js'

test('push configuration is reported as unavailable until all VAPID values are present', () => {
  const original = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
    .map((key) => [key, process.env[key]])
  for (const [key] of original) delete process.env[key]

  try {
    assert.deepEqual(getPushConfiguration(), { configured: false, publicKey: null, reason: 'missing' })
    assert.match(getPushConfigurationDiagnostic(), /VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT/)
  } finally {
    original.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
})

test('push configuration exposes only the public key for a matching VAPID pair', () => {
  const original = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
    .map((key) => [key, process.env[key]])
  const keys = webpush.generateVAPIDKeys()
  process.env.VAPID_PUBLIC_KEY = keys.publicKey
  process.env.VAPID_PRIVATE_KEY = keys.privateKey
  process.env.VAPID_SUBJECT = 'mailto:admin@example.com'

  try {
    assert.deepEqual(getPushConfiguration(), {
      configured: true,
      publicKey: process.env.VAPID_PUBLIC_KEY,
    })
    assert.equal(JSON.stringify(getPushConfiguration()).includes(keys.privateKey), false)
  } finally {
    original.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
})

test('push configuration rejects mismatched keys and invalid contact subjects', () => {
  const original = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
    .map((key) => [key, process.env[key]])
  const firstPair = webpush.generateVAPIDKeys()
  const secondPair = webpush.generateVAPIDKeys()
  process.env.VAPID_PUBLIC_KEY = firstPair.publicKey
  process.env.VAPID_PRIVATE_KEY = secondPair.privateKey
  process.env.VAPID_SUBJECT = 'mailto:admin@example.com'

  try {
    assert.deepEqual(getPushConfiguration(), { configured: false, publicKey: null, reason: 'mismatch' })
    assert.match(getPushConfigurationDiagnostic(), /must come from the same key pair/)

    process.env.VAPID_PRIVATE_KEY = firstPair.privateKey
    process.env.VAPID_SUBJECT = 'http://example.com'
    assert.deepEqual(getPushConfiguration(), { configured: false, publicKey: null, reason: 'invalid_subject' })
  } finally {
    original.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
})

test('push endpoints must use HTTPS and a supported browser push service', () => {
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/subscription'), true)
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/subscription'), true)
  assert.equal(isAllowedPushEndpoint('https://example.com/collect'), false)
  assert.equal(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/subscription'), false)
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/collect'), false)
})
