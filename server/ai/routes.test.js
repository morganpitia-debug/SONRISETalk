import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import express from 'express'
import test from 'node:test'
import aiRoutes from './routes.js'

test('AI chat forwards uploaded images and text files with their message', async (context) => {
  const originalApiKey = process.env.GEMINI_API_KEY
  const originalFetch = globalThis.fetch
  let providerRequest
  process.env.GEMINI_API_KEY = 'test-api-key'

  const app = express()
  app.use('/api/ai', aiRoutes)
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({ error: { message: error.message } })
  })
  const server = createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  context.after(async () => {
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalApiKey
    await new Promise((resolve) => server.close(resolve))
  })

  globalThis.fetch = async (_url, options) => {
    providerRequest = JSON.parse(options.body)
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'I can review those files.' }] } }] }),
    }
  }

  const form = new FormData()
  form.append('messages', JSON.stringify([{ role: 'user', text: 'What is in these files?' }]))
  form.append('fileMessageIndices', JSON.stringify([0, 0]))
  form.append('files', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'image.png')
  form.append('files', new Blob(['sample text'], { type: 'text/plain' }), 'notes.txt')
  const outgoingFetch = originalFetch
  const response = await outgoingFetch(`http://127.0.0.1:${server.address().port}/api/ai/chat`, {
    method: 'POST',
    body: form,
  })

  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.text, 'I can review those files.')
  assert.equal(providerRequest.contents[0].parts[0].text, 'What is in these files?')
  assert.deepEqual(providerRequest.contents[0].parts[1].inlineData, {
    mimeType: 'image/png',
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
  })
  assert.equal(providerRequest.contents[0].parts[2].text, '\n\nUploaded file (notes.txt):\nsample text')
})
