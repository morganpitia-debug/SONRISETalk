import { createHash } from 'node:crypto'
import { prisma } from '../db.js'

function readBearerToken(headers = {}) {
  const authorization = headers.authorization ?? headers.Authorization
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null
  return authorization.slice(7).trim() || null
}

export async function getAuthenticatedSession({ headers, socketToken }) {
  const token = readBearerToken(headers) || (typeof socketToken === 'string' ? socketToken : null)
  if (!token) return null

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = await prisma.session.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true },
  })
  return session ? { sessionId: session.id, userId: session.userId } : null
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
