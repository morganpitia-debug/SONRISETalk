import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedOrigin } from './originPolicy.js'

test('socket origins allow configured cross-origin clients', () => {
  const request = { headers: { origin: 'https://sonrisetalk-web.onrender.com', host: 'api.onrender.com' } }
  assert.equal(isAllowedOrigin(request, ['https://sonrisetalk-web.onrender.com']), true)
})

test('socket origins allow same-origin Render requests behind the proxy', () => {
  const request = {
    headers: {
      origin: 'https://sonrisetalk-api.onrender.com',
      host: 'internal-service:10000',
      'x-forwarded-host': 'sonrisetalk-api.onrender.com',
      'x-forwarded-proto': 'https',
    },
  }
  assert.equal(isAllowedOrigin(request, []), true)
})

test('socket origins reject unconfigured cross-origin clients', () => {
  const request = {
    headers: {
      origin: 'https://attacker.example',
      host: 'sonrisetalk-api.onrender.com',
      'x-forwarded-host': 'sonrisetalk-api.onrender.com',
      'x-forwarded-proto': 'https',
    },
  }
  assert.equal(isAllowedOrigin(request, []), false)
})

test('socket origins allow requests without an Origin header', () => {
  assert.equal(isAllowedOrigin({ headers: {} }, []), true)
})
