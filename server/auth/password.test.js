import test from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword } from './password.js'

test('password hashes verify only the original password', async () => {
  const passwordHash = await hashPassword('a-strong-test-passphrase')
  assert.equal(await verifyPassword('a-strong-test-passphrase', passwordHash), true)
  assert.equal(await verifyPassword('a-different-test-passphrase', passwordHash), false)
  assert.equal(await verifyPassword('anything', 'not-a-valid-hash'), false)
})
