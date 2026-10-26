export function getCallPeerId(call, userId) {
  if (call.initiatorId === userId) return call.recipientId
  if (call.recipientId === userId) return call.initiatorId
  return null
}

export function getCallEndStatus(call, userId, requestedStatus) {
  if (!getCallPeerId(call, userId)) return null
  if (requestedStatus === 'failed') return 'failed'
  if (call.status === 'ringing') return call.initiatorId === userId ? 'cancelled' : 'declined'
  return 'completed'
}

export function isValidCallSignal(signal, maxBytes) {
  if (!signal || typeof signal !== 'object') return false
  if (Buffer.byteLength(JSON.stringify(signal)) > maxBytes) return false
  if (signal.type === 'description') {
    return ['offer', 'answer'].includes(signal.description?.type)
      && typeof signal.description.sdp === 'string'
      && signal.description.sdp.length <= maxBytes
  }
  if (signal.type === 'candidate') {
    return signal.candidate === null
      || (typeof signal.candidate?.candidate === 'string' && signal.candidate.candidate.length <= 4096)
  }
  return false
}
