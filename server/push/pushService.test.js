import assert from 'node:assert/strict'
import test from 'node:test'
import { getPushConfiguration } from './pushConfig.js'
import { isAllowedPushEndpoint } from './pushValidation.js'

test('push configuration is reported as unavailable until all VAPID values are present', () => {
  const original = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
    .map((key) => [key, process.env[key]])
  delete process.env.VAPID_PRIVATE_KEY

  try {
    assert.deepEqual(getPushConfiguration(), { configured: false, publicKey: null })
  } finally {
    original.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
})

test('push configuration exposes only well-formed VAPID keys and a contact subject', () => {
  const original = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
    .map((key) => [key, process.env[key]])
  process.env.VAPID_PUBLIC_KEY = 'A'.repeat(87)
  process.env.VAPID_PRIVATE_KEY = 'B'.repeat(43)
  process.env.VAPID_SUBJECT = 'mailto:admin@example.com'

  try {
    assert.deepEqual(getPushConfiguration(), {
      configured: true,
      publicKey: process.env.VAPID_PUBLIC_KEY,
    })
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
