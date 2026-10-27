import dotenv from 'dotenv'
import { v2 as cloudinary } from 'cloudinary'
import { randomUUID } from 'node:crypto'
import { open, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

dotenv.config({ path: '.env.local' })

const allowedMimeTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
])
const allowedVoiceMimeTypes = new Set([
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav',
])
const uploadDirectory = path.join(tmpdir(), 'sonrisetalk-uploads')

export function mediaOwnershipPrefix(userId) {
  const folder = (process.env.CLOUDINARY_FOLDER || 'sonrisetalk').replace(/^\/+|\/+$/g, '')
  return `${folder}/${userId}/`
}

export function isAllowedMediaType(mimeType) {
  return allowedMimeTypes.has(mimeType.split(';', 1)[0].trim().toLowerCase())
}

export function isAllowedVoiceMimeType(mimeType) {
  return allowedVoiceMimeTypes.has(mimeType.split(';', 1)[0].trim().toLowerCase())
}

export function getVoiceNoteUploadError(error) {
  if (error?.http_code !== 401 && error?.error?.http_code !== 401) return error

  const authError = new Error('Voice-note storage rejected its credentials. Check the Cloudinary credentials in the API server environment.')
  authError.status = 503
  authError.code = 'MEDIA_PROVIDER_AUTH_FAILED'
  return authError
}

export function getMediaUploadError(error) {
  if (error?.http_code !== 401 && error?.error?.http_code !== 401) return error

  const authError = new Error('Media storage rejected its credentials. Check the Cloudinary credentials in the API server environment.')
  authError.status = 503
  authError.code = 'MEDIA_PROVIDER_AUTH_FAILED'
  return authError
}

export async function hasValidVoiceNoteSignature(file) {
  const handle = await open(file.path, 'r')
  try {
    const header = Buffer.alloc(12)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead < 4) return false
    const mimeType = file.mimetype.split(';', 1)[0].trim().toLowerCase()
    if (mimeType === 'audio/webm') return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    if (mimeType === 'audio/ogg') return header.toString('ascii', 0, 4) === 'OggS'
    if (mimeType === 'audio/mp4') return header.toString('ascii', 4, 8) === 'ftyp'
    if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') {
      return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE'
    }
    if (mimeType === 'audio/mpeg') {
      return header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
    }
    return false
  } finally {
    await handle.close()
  }
}

export async function createUploadDirectory() {
  await mkdir(uploadDirectory, { recursive: true })
  return uploadDirectory
}

export async function removeTemporaryUpload(filePath) {
  if (!filePath) return
  try {
    await unlink(filePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

export async function uploadMediaToCloudinary(file, userId) {
  const { cloudName } = configureCloudinary()
  const configuredFolder = (process.env.CLOUDINARY_FOLDER || 'sonrisetalk').replace(/^\/+|\/+$/g, '')
  const folder = `${configuredFolder}/${userId}`
  const resourceType = file.mimetype.startsWith('video/') ? 'video' : 'image'
  let uploaded
  try {
    uploaded = await cloudinary.uploader.upload(file.path, {
      folder,
      public_id: randomUUID(),
      resource_type: resourceType,
      overwrite: false,
      use_filename: false,
      unique_filename: true,
    })
  } catch (error) {
    throw getMediaUploadError(error)
  }

  return {
    url: uploaded.secure_url,
    assetId: uploaded.public_id,
    resourceType,
    mimeType: file.mimetype.split(';', 1)[0].trim().toLowerCase(),
    bytes: uploaded.bytes,
  }
}

export function configureCloudinary() {
  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim()
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim()
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim()
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim()
  if (cloudinaryUrl) {
    cloudinary.config(true)
  } else if (cloudName && apiKey && apiSecret) {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret })
  } else {
    const error = new Error('Cloudinary is not configured. Set its server credentials in .env.local.')
    error.status = 503
    error.code = 'MEDIA_PROVIDER_UNAVAILABLE'
    throw error
  }
  cloudinary.config({ secure: true })
  const configuration = cloudinary.config()
  if (!configuration.cloud_name || !configuration.api_key || !configuration.api_secret) {
    const error = new Error('Cloudinary is not configured correctly. Check CLOUDINARY_URL or the server credential fields in .env.local.')
    error.status = 503
    error.code = 'MEDIA_PROVIDER_UNAVAILABLE'
    throw error
  }
  return {
    cloudName: configuration.cloud_name,
    apiKey: configuration.api_key,
    apiSecret: configuration.api_secret,
  }
}

export async function uploadVoiceNoteToCloudinary(file, userId) {
  configureCloudinary()
  const folder = mediaOwnershipPrefix(userId).replace(/\/$/, '')
  let uploaded
  try {
    uploaded = await cloudinary.uploader.upload(file.path, {
      folder,
      public_id: randomUUID(),
      resource_type: 'video',
      type: 'authenticated',
      overwrite: false,
      use_filename: false,
      unique_filename: true,
    })
  } catch (error) {
    throw getVoiceNoteUploadError(error)
  }
  return {
    assetId: uploaded.public_id,
    format: uploaded.format,
    mimeType: file.mimetype,
    bytes: uploaded.bytes,
  }
}

export function getVoiceNotePlaybackUrl(assetId) {
  configureCloudinary()
  return cloudinary.url(assetId, {
    resource_type: 'video',
    type: 'authenticated',
    audio_codec: 'mp3',
    video_codec: 'none',
    format: 'mp3',
    sign_url: true,
    secure: true,
  })
}

export function getVoiceNoteOriginalPlaybackUrl(assetId, format = null) {
  configureCloudinary()
  return cloudinary.url(assetId, {
    resource_type: 'video',
    type: 'authenticated',
    ...(typeof format === 'string' && /^[a-z0-9]{2,8}$/i.test(format) ? { format } : {}),
    sign_url: true,
    secure: true,
  })
}

export async function fetchVoiceNoteFromCloudinary(assetId, { format, ...fetchOptions } = {}) {
  const urls = [
    getVoiceNotePlaybackUrl(assetId),
    getVoiceNoteOriginalPlaybackUrl(assetId, format),
  ]
  let lastResponse
  let lastCause
  for (const url of urls) {
    try {
      const upstream = await fetch(url, fetchOptions)
      if (upstream.ok && upstream.body) return upstream
      lastResponse = upstream
    } catch (cause) {
      lastCause = cause
    }
  }

  if (lastCause && !lastResponse) {
    const error = new Error('Voice-note storage could not be reached.', { cause: lastCause })
    error.status = 503
    error.code = 'MEDIA_PROVIDER_UNAVAILABLE'
    throw error
  }
  const notFound = lastResponse?.status === 404
  const unauthorized = lastResponse?.status === 401 || lastResponse?.status === 403
  const error = new Error(notFound
    ? 'This voice note is unavailable.'
    : unauthorized
      ? 'Cloudinary denied access to this voice note. Check the server media credentials and authenticated-delivery settings.'
      : 'Voice-note storage could not provide the recording. Try again later.')
  error.status = notFound ? 404 : 503
  error.code = notFound ? 'VOICE_NOTE_NOT_FOUND' : unauthorized ? 'MEDIA_PROVIDER_AUTH_FAILED' : 'MEDIA_PROVIDER_UNAVAILABLE'
  throw error
}

export async function deleteVoiceNoteFromCloudinary(assetId) {
  configureCloudinary()
  await cloudinary.uploader.destroy(assetId, { resource_type: 'video', type: 'authenticated' })
}

export { allowedMimeTypes }
