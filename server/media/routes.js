import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../auth/session.js'
import {
  createUploadDirectory,
  isAllowedMediaType,
  removeTemporaryUpload,
  uploadMediaToCloudinary,
} from './mediaService.js'

const router = Router()
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_request, _file, callback) => {
      try {
        callback(null, await createUploadDirectory())
      } catch (error) {
        callback(error)
      }
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!isAllowedMediaType(file.mimetype)) {
      const error = new Error('Choose a supported image or video file.')
      error.status = 400
      error.code = 'UNSUPPORTED_MEDIA_TYPE'
      callback(error)
      return
    }
    callback(null, true)
  },
})

router.post('/upload', requireAuth, upload.single('file'), async (request, response, next) => {
  if (!request.file) {
    response.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'Choose an image or video to upload.' } })
    return
  }

  try {
    const media = await uploadMediaToCloudinary(request.file, request.auth.userId)
    response.status(201).json({ data: media })
  } catch (error) {
    next(error)
  } finally {
    await removeTemporaryUpload(request.file.path)
  }
})

export default router
