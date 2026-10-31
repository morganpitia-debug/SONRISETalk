import { getAuthToken, request } from './auth.js'

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

function requestData(path, options) {
  return request(path, options).then((response) => response.data)
}

export function getConversations({ signal } = {}) {
  return requestData('/api/conversations', { signal })
}

export function getCallHistory({ signal } = {}) {
  return requestData('/api/calls/history', { signal })
}

export function createConversation(participantIds, group = null) {
  return requestData('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ participantIds, ...(group || {}) }),
  })
}

export function getMessages(conversationId, { before, signal } = {}) {
  const params = new URLSearchParams()
  if (before) params.set('before', before)
  const query = params.size ? `?${params.toString()}` : ''
  return requestData(`/api/conversations/${encodeURIComponent(conversationId)}/messages${query}`, { signal })
}

export function setConversationMuted(conversationId, muted) {
  return requestData(`/api/conversations/${encodeURIComponent(conversationId)}/mute`, {
    method: 'PUT',
    body: JSON.stringify({ muted }),
  })
}

export function setConversationNickname(conversationId, nickname) {
  return requestData(`/api/conversations/${encodeURIComponent(conversationId)}/nickname`, {
    method: 'PUT',
    body: JSON.stringify({ nickname }),
  })
}

export function setConversationWallpaper(conversationId, wallpaper) {
  return requestData(`/api/conversations/${encodeURIComponent(conversationId)}/wallpaper`, {
    method: 'PUT',
    body: JSON.stringify({ wallpaper }),
  })
}

export function getAddableGroupMembers(conversationId) {
  return requestData(`/api/conversations/${encodeURIComponent(conversationId)}/addable-members`)
}

export function addGroupMembers(conversationId, participantIds) {
  return requestData(`/api/conversations/${encodeURIComponent(conversationId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ participantIds }),
  })
}

export function leaveGroup(conversationId) {
  return requestData(`/api/conversations/${encodeURIComponent(conversationId)}/membership`, { method: 'DELETE' })
}

export function refreshVoiceNoteUrl(conversationId, messageId) {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/voice-note`, {
    responseType: 'blob',
  }).then((blob) => URL.createObjectURL(blob))
}

export function createRealtimeSocket() {
  return import('socket.io-client').then(({ io }) => io(apiBaseUrl || undefined, {
    auth: { token: getAuthToken() },
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    timeout: 10000,
  }))
}

export function getIceServers() {
  return requestData('/api/ice-servers')
}

export async function uploadVoiceNote(conversationId, blob) {
  const formData = new FormData()
  formData.append('audio', blob, `voice-note-${Date.now()}.${blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'}`)
  const response = await request(`/api/conversations/${encodeURIComponent(conversationId)}/voice-notes`, {
    method: 'POST',
    body: formData,
  })
  return response.data.message
}
