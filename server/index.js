import dotenv from 'dotenv'
import { createServer } from 'node:http'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { prisma } from './db.js'
import authRoutes from './auth/routes.js'
import aiRoutes from './ai/routes.js'
import mediaRoutes from './media/routes.js'
import messagingRoutes from './messaging/routes.js'
import notificationsRoutes from './notifications/routes.js'
import { attachSocketServer } from './realtime/socketServer.js'
import realtimeRoutes from './realtime/routes.js'
import socialRoutes from './social/routes.js'
import adminRoutes from './admin/routes.js'

dotenv.config({ path: '.env.local' })

const app = express()
const httpServer = createServer(app)
const port = Number(process.env.PORT || 3001)
const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

app.use((request, response, next) => {
  const origin = request.headers.origin
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type')
  }
  if (request.method === 'OPTIONS') {
    response.status(origin && !allowedOrigins.has(origin) ? 403 : 204).end()
    return
  }
  next()
})

app.use(express.json({ limit: '1mb' }))
app.get('/', (_request, response) => response.status(200).json({
  data: {
    name: 'SONRISETALK API',
    status: 'ok',
    health: '/api/health',
  },
}))
app.get('/api/health', (_request, response) => response.status(200).json({ data: { status: 'ok' } }))
app.use('/api/auth', authRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/media', rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'UPLOAD_RATE_LIMITED', message: 'Too many uploads. Try again later.' } },
}), mediaRoutes)
app.use('/api/conversations', messagingRoutes)
app.use('/api/notifications', notificationsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api', realtimeRoutes)
app.use('/api', socialRoutes)

app.use((error, _request, response, _next) => {
  const status = error.status
    || (['LIMIT_FILE_SIZE', 'LIMIT_FIELD_VALUE'].includes(error.code) ? 413
      : ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error.code) ? 400
        : 500)
  if (status >= 500) console.error('API request failed:', error)
  response.status(status).json({
    error: {
      code: error.code || (status === 413 ? 'FILE_TOO_LARGE' : 'INTERNAL_ERROR'),
      message: status >= 500 ? 'The request could not be completed.' : error.message,
    },
  })
})

const socketClientUrls = (process.env.SOCKET_CLIENT_URLS || [...allowedOrigins].join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
attachSocketServer(httpServer, { clientUrl: socketClientUrls })

await prisma.$connect()
httpServer.listen(port, () => {
  console.log(`SONRISETALK API listening on http://localhost:${port}`)
})

async function shutdown() {
  httpServer.close()
  await prisma.$disconnect()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
