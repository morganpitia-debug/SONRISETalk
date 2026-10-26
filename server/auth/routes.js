import { randomBytes, createHash } from 'node:crypto'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { prisma } from '../db.js'
import { requireAuth } from './session.js'
import { hashPassword, verifyPassword } from './password.js'

const router = Router()
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } },
})

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

async function createSession(userId) {
  const token = randomBytes(32).toString('base64url')
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    },
  })
  return token
}

router.post('/register', authLimiter, async (request, response, next) => {
  try {
    const { method, email, phone, username, name, password, birthday } = request.body ?? {}
    const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : ''
    const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null
    const normalizedPhone = typeof phone === 'string' && phone.trim() ? phone.trim() : null

    if (!['email', 'phone'].includes(method)
      || !normalizedUsername || !/^[a-z0-9._]{3,30}$/.test(normalizedUsername)
      || typeof name !== 'string' || !name.trim() || name.trim().length > 120
      || typeof password !== 'string' || password.length < 8 || password.length > 256
      || (method === 'email' && (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)))
      || (method === 'phone' && !normalizedPhone)) {
      response.status(400).json({ error: { code: 'INVALID_REGISTRATION', message: 'Check your account details and try again.' } })
      return
    }

    const user = await prisma.user.create({
      data: {
        username: normalizedUsername,
        email: method === 'email' ? normalizedEmail : null,
        phone: method === 'phone' ? normalizedPhone : null,
        passwordHash: await hashPassword(password),
        ...(typeof birthday === 'string' && !Number.isNaN(Date.parse(birthday)) ? { birthday: new Date(birthday) } : {}),
        profile: { create: { name: name.trim() } },
        settings: { create: {} },
      },
      include: { profile: true },
    })
    const token = await createSession(user.id)
    response.status(201).json({
      data: {
        token,
        user: { id: user.id, username: user.username, name: user.profile.name, profilePicture: user.profile.profilePicture },
      },
    })
  } catch (error) {
    if (error?.code === 'P2002') {
      response.status(409).json({ error: { code: 'ACCOUNT_EXISTS', message: 'That email, phone, or username is already registered.' } })
      return
    }
    next(error)
  }
})

router.post('/login', authLimiter, async (request, response, next) => {
  try {
    const identifier = typeof request.body?.identifier === 'string' ? request.body.identifier.trim() : ''
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    if (!identifier || !password) {
      response.status(400).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Enter your account identifier and password.' } })
      return
    }

    const normalizedIdentifier = identifier.toLowerCase()
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: normalizedIdentifier }, { email: normalizedIdentifier }, { phone: identifier }] },
      include: { profile: true },
    })
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'The username, email, phone, or password is incorrect.' } })
      return
    }

    const token = await createSession(user.id)
    response.status(200).json({
      data: {
        token,
        user: { id: user.id, username: user.username, name: user.profile?.name ?? user.username, profilePicture: user.profile?.profilePicture ?? null },
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/logout', requireAuth, async (request, response, next) => {
  try {
    await prisma.session.update({
      where: { id: request.auth.sessionId },
      data: { revokedAt: new Date() },
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
