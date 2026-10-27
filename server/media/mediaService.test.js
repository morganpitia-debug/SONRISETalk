import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { configureCloudinary, fetchVoiceNoteFromCloudinary, getMediaUploadError, getVoiceNoteOriginalPlaybackUrl, getVoiceNotePlaybackUrl, getVoiceNoteUploadError, hasValidVoiceNoteSignature, isAllowedMediaType, isAllowedVoiceMimeType } from './mediaService.js'

test('Cloudinary configuration accepts a CLOUDINARY_URL', () => {
  const originalUrl = process.env.CLOUDINARY_URL
  const originalValues = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
    .map((key) => [key, process.env[key]])
  process.env.CLOUDINARY_URL = 'cloudinary://test-key:test-secret@test-cloud'
  originalValues.forEach(([key]) => delete process.env[key])

  try {
    const configuration = configureCloudinary()
    assert.equal(configuration.cloudName, 'test-cloud')
    assert.equal(configuration.apiKey, 'test-key')
    assert.equal(configuration.apiSecret, 'test-secret')
  } finally {
    if (originalUrl === undefined) delete process.env.CLOUDINARY_URL
    else process.env.CLOUDINARY_URL = originalUrl
    originalValues.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
    configureCloudinary()
  }
})

test('voice-note MIME types accept codec parameters but reject unrelated files', () => {
  assert.equal(isAllowedVoiceMimeType('audio/webm;codecs=opus'), true)
  assert.equal(isAllowedVoiceMimeType('audio/ogg'), true)
  assert.equal(isAllowedVoiceMimeType('image/png'), false)
})

test('media uploads accept codec parameters and normalize to supported MIME types', () => {
  assert.equal(isAllowedMediaType('video/mp4;codecs=avc1.42E01E,mp4a.40.2'), true)
  assert.equal(isAllowedMediaType('video/webm;codecs=vp8,opus'), true)
  assert.equal(isAllowedMediaType('application/octet-stream'), false)
})

test('voice-note playback uses authenticated MP3-only delivery', () => {
  const url = new URL(getVoiceNotePlaybackUrl('sonrisetalk/test-asset'))
  assert.equal(url.hostname, 'res.cloudinary.com')
  assert.match(url.pathname, /\/video\/authenticated\/s--[^/]+--\/ac_mp3,vc_none\//)
  assert.equal(url.pathname.endsWith('.mp3'), true)
})

test('voice-note playback falls back to original audio when MP3 conversion is unavailable', async (context) => {
  const requestedUrls = []
  context.mock.method(globalThis, 'fetch', async (url) => {
    requestedUrls.push(String(url))
    if (requestedUrls.length === 1) return new Response('conversion unavailable', { status: 400 })
    return new Response('audio', { status: 200, headers: { 'content-type': 'audio/webm' } })
  })
  const response = await fetchVoiceNoteFromCloudinary('sonrisetalk/test-asset')
  assert.equal(requestedUrls.length, 2)
  assert.match(requestedUrls[0], /ac_mp3,vc_none/)
  assert.equal(requestedUrls[1], getVoiceNoteOriginalPlaybackUrl('sonrisetalk/test-asset'))
  assert.equal(response.headers.get('content-type'), 'audio/webm')
})

test('voice-note playback is fetched server-side and provider errors are explicit', async (context) => {
  let requestedUrl
  context.mock.method(globalThis, 'fetch', async (url) => {
    requestedUrl = String(url)
    if (requestedUrl.includes('missing-asset')) return new Response(null, { status: 404 })
    return new Response('audio', { status: 200, headers: { 'content-type': 'audio/mpeg' } })
  })
  const response = await fetchVoiceNoteFromCloudinary('sonrisetalk/test-asset')
  assert.match(requestedUrl, /^https:\/\/res\.cloudinary\.com\//)
  assert.equal(response.headers.get('content-type'), 'audio/mpeg')

  await assert.rejects(fetchVoiceNoteFromCloudinary('sonrisetalk/missing-asset'), {
    status: 404,
    code: 'VOICE_NOTE_NOT_FOUND',
  })
})

test('voice-note storage authentication failures return an actionable service error', () => {
  const error = getVoiceNoteUploadError({ error: { http_code: 401 } })
  assert.equal(error.status, 503)
  assert.equal(error.code, 'MEDIA_PROVIDER_AUTH_FAILED')
  assert.match(error.message, /Cloudinary credentials/)
  assert.equal(getVoiceNoteUploadError({ http_code: 400 }).http_code, 400)
})

test('media storage authentication failures return an actionable service error', () => {
  const error = getMediaUploadError({ http_code: 401 })
  assert.equal(error.status, 503)
  assert.equal(error.code, 'MEDIA_PROVIDER_AUTH_FAILED')
  assert.match(error.message, /Cloudinary credentials/)
  assert.equal(getMediaUploadError({ http_code: 400 }).http_code, 400)
})

test('voice-note upload signatures must match their declared media type', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sonrisetalk-audio-test-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const validCases = [
    ['audio/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])],
    ['audio/ogg', Buffer.from('OggS')],
    ['audio/mp4', Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70])],
    ['audio/mpeg', Buffer.from('ID3\0\0\0\0\0\0\0')],
    ['audio/wav', Buffer.from('RIFF0000WAVE')],
  ]

  for (const [index, [mimetype, contents]] of validCases.entries()) {
    const filePath = path.join(directory, `valid-${index}`)
    await writeFile(filePath, contents)
    assert.equal(await hasValidVoiceNoteSignature({ path: filePath, mimetype }), true)
  }

  const spoofedPath = path.join(directory, 'spoofed')
  await writeFile(spoofedPath, Buffer.from('not audio'))
  assert.equal(await hasValidVoiceNoteSignature({ path: spoofedPath, mimetype: 'audio/ogg' }), false)
})
