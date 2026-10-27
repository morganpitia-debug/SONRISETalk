import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import multer from 'multer'

const router = Router()
const GEMINI_MODEL = 'gemini-2.5-flash'
const MAX_PROMPT_LENGTH = 6000
const MAX_HISTORY_MESSAGES = 12
const MAX_FILES = 4
const MAX_FILE_BYTES = 3 * 1024 * 1024
const MAX_TOTAL_FILE_BYTES = 12 * 1024 * 1024
const allowedFileTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fieldSize: 300_000 },
  fileFilter: (_request, file, callback) => {
    if (!allowedFileTypes.has(file.mimetype.toLowerCase())) {
      const error = new Error('Choose images, PDFs, or text files (TXT, MD, CSV).')
      error.status = 400
      error.code = 'UNSUPPORTED_FILE_TYPE'
      callback(error)
      return
    }
    callback(null, true)
  },
})

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'AI_RATE_LIMITED', message: 'Too many AI requests. Try again later.' } },
})

router.get('/status', (_request, response) => {
  response.status(200).json({ data: { configured: Boolean(process.env.GEMINI_API_KEY?.trim()) } })
})

router.post('/chat', chatLimiter, upload.array('files', MAX_FILES), async (request, response) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    response.status(503).json({ error: { code: 'AI_NOT_CONFIGURED', message: 'The AI assistant is not available right now.' } })
    return
  }

  let messages
  try {
    messages = JSON.parse(request.body?.messages || 'null')
  } catch {
    response.status(400).json({ error: { code: 'INVALID_MESSAGES', message: 'Enter a message to continue.' } })
    return
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    response.status(400).json({ error: { code: 'INVALID_MESSAGES', message: 'Enter a message to continue.' } })
    return
  }

  const uploadedFiles = request.files || []
  const totalFileBytes = uploadedFiles.reduce((total, file) => total + file.size, 0)
  if (totalFileBytes > MAX_TOTAL_FILE_BYTES) {
    response.status(413).json({ error: { code: 'FILES_TOO_LARGE', message: 'Together, uploaded files must be 12 MB or smaller.' } })
    return
  }

  const history = messages.slice(-MAX_HISTORY_MESSAGES)
  let fileMessageIndices
  try {
    fileMessageIndices = JSON.parse(request.body?.fileMessageIndices || '[]')
  } catch {
    response.status(400).json({ error: { code: 'INVALID_MESSAGES', message: 'Enter a message to continue.' } })
    return
  }
  if (!Array.isArray(fileMessageIndices) || fileMessageIndices.length !== uploadedFiles.length) {
    response.status(400).json({ error: { code: 'INVALID_MESSAGES', message: 'Enter a message to continue.' } })
    return
  }

  const contents = history
    .map((message, messageIndex) => ({ message, messageIndex }))
    .filter(({ message, messageIndex }) => (
      message
      && ['user', 'assistant'].includes(message.role)
      && typeof message.text === 'string'
      && (message.text.trim() || (message.role === 'user' && fileMessageIndices.includes(messageIndex)))
    ))
    .map(({ message, messageIndex }) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      messageIndex,
      parts: message.text.trim() ? [{ text: message.text.trim().slice(0, MAX_PROMPT_LENGTH) }] : [],
    }))

  if (contents.length === 0 || contents.at(-1).role !== 'user') {
    response.status(400).json({ error: { code: 'INVALID_MESSAGES', message: 'Enter a message to continue.' } })
    return
  }

  for (const [fileIndex, file] of uploadedFiles.entries()) {
    const messageIndex = fileMessageIndices[fileIndex]
    const content = contents.find((item) => item.messageIndex === messageIndex && item.role === 'user')
    if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= history.length || !content) {
      response.status(400).json({ error: { code: 'INVALID_MESSAGES', message: 'Enter a message to continue.' } })
      return
    }
    if (file.mimetype.startsWith('text/')) {
      content.parts.push({
        text: `\n\nUploaded file (${file.originalname}):\n${file.buffer.toString('utf8')}`,
      })
    } else {
      content.parts.push({
        inlineData: {
          mimeType: file.mimetype,
          data: file.buffer.toString('base64'),
        },
      })
    }
  }

  if (contents.at(-1).parts.length === 0) {
    response.status(400).json({ error: { code: 'INVALID_MESSAGES', message: 'Enter a message to continue.' } })
    return
  }

  const geminiContents = contents.map(({ role, parts }) => ({ role, parts }))
  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'You are SONRISE AI, a warm, thoughtful, and practical assistant. Be clear and respectful. Do not claim to be a human or a licensed professional. Analyze only files included in the current request, and be clear if an earlier upload is no longer available.' }],
          },
          contents: geminiContents,
          generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
        }),
        signal: AbortSignal.timeout(45000),
      },
    )

    if (!geminiResponse.ok) {
      const providerStatus = geminiResponse.status
      const status = providerStatus === 429 ? 503 : 502
      const message = providerStatus === 401 || providerStatus === 403
        ? 'Gemini rejected the server API key or does not have API access. Check GEMINI_API_KEY in the Render Web Service environment.'
        : providerStatus === 404
          ? 'The configured Gemini model is unavailable. Check the model name and API access.'
          : providerStatus === 429
            ? 'The Gemini service is busy or its quota has been reached. Check the project quota or try again later.'
            : 'The AI service could not complete this request. Please try again.'
      console.error('Gemini request failed:', { status: providerStatus })
      response.status(status).json({
        error: {
          code: providerStatus === 401 || providerStatus === 403
            ? 'AI_PROVIDER_AUTH_FAILED'
            : providerStatus === 404
              ? 'AI_MODEL_UNAVAILABLE'
              : providerStatus === 429
                ? 'AI_PROVIDER_BUSY'
                : 'AI_PROVIDER_ERROR',
          message,
        },
      })
      return
    }

    const result = await geminiResponse.json()
    const text = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter((part) => typeof part === 'string')
      .join('')
      .trim()

    if (!text) {
      response.status(502).json({ error: { code: 'AI_EMPTY_RESPONSE', message: 'The AI service returned an empty response. Please try again.' } })
      return
    }

    response.status(200).json({ data: { text } })
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      response.status(504).json({ error: { code: 'AI_TIMEOUT', message: 'The AI service took too long to respond. Please try again.' } })
      return
    }
    console.error('Gemini request could not be completed:', error.name || 'UnknownError')
    response.status(502).json({ error: { code: 'AI_PROVIDER_ERROR', message: 'The AI service could not complete this request. Please try again.' } })
  }
})

export default router
