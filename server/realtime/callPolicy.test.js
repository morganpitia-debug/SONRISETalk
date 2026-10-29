import test from 'node:test'
import assert from 'node:assert/strict'
import { getCallEndStatus, getCallPeerId, isValidCallActivity, isValidCallSignal } from './callPolicy.js'

const call = {
  initiatorId: 'caller',
  recipientId: 'recipient',
  status: 'ringing',
}

test('only call participants can address a peer', () => {
  assert.equal(getCallPeerId(call, 'caller'), 'recipient')
  assert.equal(getCallPeerId(call, 'recipient'), 'caller')
  assert.equal(getCallPeerId(call, 'stranger'), null)
})

test('call end outcomes follow participant role and call state', () => {
  assert.equal(getCallEndStatus(call, 'caller', 'completed'), 'cancelled')
  assert.equal(getCallEndStatus(call, 'recipient', 'completed'), 'declined')
  assert.equal(getCallEndStatus(call, 'caller', 'failed'), 'failed')
  assert.equal(getCallEndStatus({ ...call, status: 'connected' }, 'caller', 'completed'), 'completed')
  assert.equal(getCallEndStatus(call, 'stranger', 'completed'), null)
})

test('call signaling accepts bounded SDP and ICE candidates only', () => {
  assert.equal(isValidCallSignal({ type: 'description', description: { type: 'offer', sdp: 'v=0' } }, 1024), true)
  assert.equal(isValidCallSignal({ type: 'candidate', candidate: { candidate: 'candidate:1' } }, 1024), true)
  assert.equal(isValidCallSignal({ type: 'description', description: { type: 'offer', sdp: 'x'.repeat(1025) } }, 1024), false)
  assert.equal(isValidCallSignal({ type: 'description', description: { type: 'pranswer', sdp: 'v=0' } }, 1024), false)
  assert.equal(isValidCallSignal({ type: 'candidate', candidate: { candidate: 'x'.repeat(4097) } }, 8192), false)
  assert.equal(isValidCallSignal({ type: 'unknown' }, 1024), false)
})

test('call activity only accepts supported reactions, hand state, and bounded chat', () => {
  assert.equal(isValidCallActivity({ type: 'reaction', emoji: '❤️' }), true)
  assert.equal(isValidCallActivity({ type: 'hand', raised: true }), true)
  assert.equal(isValidCallActivity({ type: 'share', sharing: false }), true)
  assert.equal(isValidCallActivity({ type: 'chat', text: 'Hello' }), true)
  assert.equal(isValidCallActivity({ type: 'reaction', emoji: '<script>' }), false)
  assert.equal(isValidCallActivity({ type: 'hand', raised: 'yes' }), false)
  assert.equal(isValidCallActivity({ type: 'chat', text: ' ' }), false)
  assert.equal(isValidCallActivity({ type: 'chat', text: 'x'.repeat(501) }), false)
  assert.equal(isValidCallActivity({ type: 'unknown' }), false)
})
