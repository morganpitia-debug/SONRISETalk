import { request } from './auth.js'

export async function getSonriseAIStatus({ signal } = {}) {
  const response = await request('/api/ai/status', { signal })
  return response.data
}

export async function sendSonriseAIMessage(messages, files = [], { signal } = {}) {
  const body = new FormData()
  body.append('messages', JSON.stringify(messages))
  body.append('fileMessageIndices', JSON.stringify(files.map(({ messageIndex }) => messageIndex)))
  files.forEach(({ file }) => body.append('files', file))
  const response = await request('/api/ai/chat', {
    method: 'POST',
    body,
    signal,
  })
  return response.data
}
