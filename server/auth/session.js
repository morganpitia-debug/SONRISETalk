import { createHash } from 'node:crypto'
import { prisma } from '../db.js'

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function readBearerToken(headers = {}) {
  const authorization = headers.authorization ?? headers.Authorization
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null
  return authorization.slice(7).trim() || null
}

export async function getAuthenticatedSession({ headers, socketToken }) {
  const token = readBearerToken(headers) || (typeof socketToken === 'string' ? socketToken : null)
  if (!token) return null

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const now = new Date()
  const session = await prisma.session.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true, expiresAt: true },
  })
  if (!session) return null

  if (session.expiresAt.getTime() - now.getTime() <= SESSION_RENEWAL_WINDOW_MS) {
    const renewed = await prisma.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: new Date(now.getTime() + SESSION_DURATION_MS) },
    })
    if (renewed.count !== 1) return null
  }

  return { sessionId: session.id, userId: session.userId }
}

export async function requireAuth(request, response, next) {
  try {
    const session = await getAuthenticatedSession({ headers: request.headers })
    if (!session) {
      response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
      return
    }
    request.auth = session
    next()
  } catch (error) {
    next(error)
  }
}
