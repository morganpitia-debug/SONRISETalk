import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import multer from 'multer'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { prisma } from '../db.js'
import { requireAuth } from './session.js'
import { createRecoveryToken, hashRecoveryToken, hashPassword, passwordMeetsPolicy, verifyPassword } from './password.js'
import { createChallengeExpiry, getWebAuthnConfig } from './passkeys.js'
import { decryptFaceReference, encryptFaceReference, isFaceRecoveryConfigured, verifyFaceFrame } from './faceRecovery.js'

const router = Router()
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1000
const FACE_IMAGE_LIMIT_BYTES = 768 * 1024
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } },
})
const faceRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'FACE_RECOVERY_RATE_LIMITED', message: 'Too many face recovery attempts. Try passkey recovery or try again later.' } },
})
const faceImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FACE_IMAGE_LIMIT_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype !== 'image/jpeg') {
      const error = new Error('Use a JPEG camera image.')
      error.status = 400
      error.code = 'INVALID_FACE_IMAGE'
      callback(error)
      return
    }
    callback(null, true)
  },
})

function isValidFaceImage(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
}

function faceIdentifierWhere(identifier) {
  const value = typeof identifier === 'string' ? identifier.trim() : ''
  if (!value) return null
  return {
    OR: [
      { username: value.toLowerCase() },
      { email: value.toLowerCase() },
      { phone: value },
    ],
  }
}

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

async function findUserByIdentifier(identifier) {
  const value = typeof identifier === 'string' ? identifier.trim() : ''
  if (!value) return null

  return prisma.user.findFirst({
    where: {
      OR: [
        { username: value.toLowerCase() },
        { email: value.toLowerCase() },
        { phone: value },
      ],
    },
    include: {
      profile: true,
      _count: { select: { passkeyCredentials: true } },
    },
  })
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
        user: { id: user.id, username: user.username, name: user.profile.name, profilePicture: user.profile.profilePicture, hasPasskey: false },
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

    const user = await findUserByIdentifier(identifier)
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'The username, email, phone, or password is incorrect.' } })
      return
    }

    const token = await createSession(user.id)
    response.status(200).json({
      data: {
        token,
        user: { id: user.id, username: user.username, name: user.profile?.name ?? user.username, profilePicture: user.profile?.profilePicture ?? null, hasPasskey: user._count.passkeyCredentials > 0 },
      },
    })
  } catch (error) {
    next(error)
  }
})

async function handleResetPassword(request, response, next) {
  try {
    const token = typeof request.body?.token === 'string' ? request.body.token.trim() : ''
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    if (!token || !passwordMeetsPolicy(password)) {
      response.status(400).json({ error: { code: 'INVALID_RESET_PASSWORD', message: 'Use a valid recovery token and choose a strong password.' } })
      return
    }

    const tokenHash = hashRecoveryToken(token)
    const challenge = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
          },
        },
      },
    })

    if (!challenge || challenge.usedAt || challenge.expiresAt.getTime() <= Date.now()) {
      response.status(401).json({ error: { code: 'INVALID_RESET_TOKEN', message: 'This recovery token has expired or was already used.' } })
      return
    }

    const user = challenge.user
    if (!user) {
      response.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'The account could not be located for this recovery request.' } })
      return
    }

    const reset = await prisma.$transaction(async (tx) => {
      const claimedToken = await tx.passwordResetToken.updateMany({
        where: {
          id: challenge.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      })
      if (claimedToken.count !== 1) return false

      await tx.passwordResetToken.deleteMany({
        where: { userId: user.id, id: { not: challenge.id } },
      })
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password) },
      })
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      return true
    })

    if (!reset) {
      response.status(401).json({ error: { code: 'INVALID_RESET_TOKEN', message: 'This recovery token has expired or was already used.' } })
      return
    }

    response.status(200).json({
      data: {
        message: 'Your password was reset successfully. Sign in with your new password.',
      },
    })
  } catch (error) {
    next(error)
  }
}

router.post('/reset-password', authLimiter, handleResetPassword)
router.post('/confirm-password-reset', authLimiter, handleResetPassword)

router.get('/face-recovery', requireAuth, async (request, response, next) => {
  try {
    const enrollment = await prisma.faceRecoveryEnrollment.findUnique({
      where: { userId: request.auth.userId },
      select: { id: true },
    })
    response.status(200).json({
      data: {
        enabled: Boolean(enrollment),
        available: isFaceRecoveryConfigured(),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/face-recovery/enroll', faceRecoveryLimiter, requireAuth, faceImageUpload.single('frame'), async (request, response, next) => {
  const frame = request.file?.buffer
  try {
    if (!isFaceRecoveryConfigured()) {
      response.status(503).json({ error: { code: 'FACE_RECOVERY_UNAVAILABLE', message: 'Face recovery is not configured.' } })
      return
    }
    if (!frame || !isValidFaceImage(frame)) {
      response.status(400).json({ error: { code: 'INVALID_FACE_IMAGE', message: 'Capture a valid camera image and try again.' } })
      return
    }
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    const user = await prisma.user.findUnique({
      where: { id: request.auth.userId },
      select: { id: true, passwordHash: true },
    })
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      response.status(401).json({ error: { code: 'REAUTHENTICATION_REQUIRED', message: 'Enter your current password to enable face recovery.' } })
      return
    }

    const imageIsValid = await verifyFaceFrame({
      userId: user.id,
      reference: Buffer.from(frame),
      frame: Buffer.from(frame),
    })
    if (!imageIsValid) {
      response.status(400).json({ error: { code: 'FACE_ENROLLMENT_REJECTED', message: 'A clear live face could not be verified. Try again or keep using passkeys.' } })
      return
    }

    const encrypted = encryptFaceReference(frame)
    await prisma.faceRecoveryEnrollment.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...encrypted },
      update: encrypted,
    })
    response.status(201).json({ data: { enabled: true } })
  } catch (error) {
    next(error)
  } finally {
    frame?.fill(0)
  }
})

router.delete('/face-recovery', requireAuth, async (request, response, next) => {
  try {
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    const user = await prisma.user.findUnique({
      where: { id: request.auth.userId },
      select: { passwordHash: true },
    })
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      response.status(401).json({ error: { code: 'REAUTHENTICATION_REQUIRED', message: 'Enter your current password to disable face recovery.' } })
      return
    }
    await prisma.$transaction(async (tx) => {
      await tx.faceRecoveryEnrollment.deleteMany({
        where: { userId: request.auth.userId },
      })
      await tx.passwordResetToken.deleteMany({
        where: { userId: request.auth.userId },
      })
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.post('/recover-password', faceRecoveryLimiter, faceImageUpload.single('frame'), async (request, response, next) => {
  const frame = request.file?.buffer
  let reference
  try {
    if (!isFaceRecoveryConfigured()) {
      response.status(503).json({ error: { code: 'FACE_RECOVERY_UNAVAILABLE', message: 'Face recovery is not configured. Try passkey recovery instead.' } })
      return
    }
    if (!frame || !isValidFaceImage(frame)) {
      response.status(400).json({ error: { code: 'INVALID_FACE_IMAGE', message: 'Capture a valid camera image and try again.' } })
      return
    }
    const where = faceIdentifierWhere(request.body?.identifier)
    if (!where) {
      response.status(400).json({ error: { code: 'INVALID_RECOVERY_REQUEST', message: 'Enter your username, email, or phone number.' } })
      return
    }

    const user = await prisma.user.findFirst({
      where,
      include: { profile: true, faceRecoveryEnrollment: true },
    })
    if (!user?.faceRecoveryEnrollment) {
      response.status(401).json({ error: { code: 'FACE_VERIFICATION_FAILED', message: 'We could not verify this account. Try passkey recovery instead.' } })
      return
    }

    reference = decryptFaceReference(user.faceRecoveryEnrollment)
    const verified = await verifyFaceFrame({
      userId: user.id,
      reference,
      frame,
    })
    reference = null
    frame.fill(0)
    if (!verified) {
      response.status(401).json({ error: { code: 'FACE_VERIFICATION_FAILED', message: 'We could not verify this account. Try passkey recovery instead.' } })
      return
    }

    const token = createRecoveryToken()
    const recoveryEnabled = await prisma.$transaction(async (tx) => {
      const nextUpdatedAt = new Date(Math.max(
        Date.now(),
        user.faceRecoveryEnrollment.updatedAt.getTime() + 1,
      ))
      const currentEnrollment = await tx.faceRecoveryEnrollment.updateMany({
        where: {
          userId: user.id,
          id: user.faceRecoveryEnrollment.id,
          updatedAt: user.faceRecoveryEnrollment.updatedAt,
        },
        data: { updatedAt: nextUpdatedAt },
      })
      if (currentEnrollment.count !== 1) return false
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } })
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashRecoveryToken(token),
          expiresAt: new Date(Date.now() + RECOVERY_TOKEN_TTL_MS),
        },
      })
      return true
    })
    if (!recoveryEnabled) {
      response.status(401).json({ error: { code: 'FACE_VERIFICATION_FAILED', message: 'We could not verify this account. Try passkey recovery instead.' } })
      return
    }
    response.status(200).json({
      data: {
        token,
        profile: {
          name: user.profile?.name ?? user.username,
          username: user.username,
          profilePicture: user.profile?.profilePicture ?? null,
        },
      },
    })
  } catch (error) {
    next(error)
  } finally {
    reference?.fill(0)
    frame?.fill(0)
  }
})

router.post('/passkeys/register/options', authLimiter, requireAuth, async (request, response, next) => {
  try {
    const config = getWebAuthnConfig(request.headers.origin)
    if (!config) {
      response.status(400).json({ error: { code: 'INVALID_WEBAUTHN_ORIGIN', message: 'Passkey setup must start from a configured app origin.' } })
      return
    }

    const user = await prisma.user.findUnique({
      where: { id: request.auth.userId },
      include: { profile: true, passkeyCredentials: true },
    })
    if (!user) {
      response.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'The signed-in account could not be located.' } })
      return
    }

    const options = await generateRegistrationOptions({
      rpName: 'SONRISETALK',
      rpID: config.rpID,
      userID: Buffer.from(user.id),
      userName: user.username,
      userDisplayName: user.profile?.name ?? user.username,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      preferredAuthenticatorType: 'localDevice',
      excludeCredentials: user.passkeyCredentials.map(({ credentialId, transports }) => ({
        id: credentialId,
        transports,
      })),
    })
    const challengeId = randomUUID()

    await prisma.webAuthnChallenge.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    })
    await prisma.webAuthnChallenge.create({
      data: {
        id: challengeId,
        userId: user.id,
        purpose: 'registration',
        challenge: options.challenge,
        expiresAt: createChallengeExpiry(),
      },
    })

    response.status(200).json({
      data: {
        challengeId,
        options,
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/passkeys/register/verify', authLimiter, requireAuth, async (request, response, next) => {
  try {
    const config = getWebAuthnConfig(request.headers.origin)
    const challengeId = typeof request.body?.challengeId === 'string' ? request.body.challengeId : ''
    const credentialResponse = request.body?.response
    if (!config || !challengeId || !credentialResponse || typeof credentialResponse.id !== 'string') {
      response.status(400).json({ error: { code: 'INVALID_PASSKEY_RESPONSE', message: 'The passkey registration response is incomplete or came from an unrecognized app origin.' } })
      return
    }

    const challenge = await prisma.webAuthnChallenge.findFirst({
      where: {
        id: challengeId,
        userId: request.auth.userId,
        purpose: 'registration',
        expiresAt: { gt: new Date() },
      },
    })
    if (!challenge) {
      response.status(401).json({ error: { code: 'PASSKEY_CHALLENGE_EXPIRED', message: 'Passkey setup expired. Start again.' } })
      return
    }

    const claim = await prisma.webAuthnChallenge.deleteMany({
      where: {
        id: challenge.id,
        challenge: challenge.challenge,
        purpose: 'registration',
        userId: request.auth.userId,
        expiresAt: { gt: new Date() },
      },
    })
    if (claim.count !== 1) {
      response.status(401).json({ error: { code: 'PASSKEY_CHALLENGE_EXPIRED', message: 'Passkey setup expired. Start again.' } })
      return
    }

    let verification
    try {
      verification = await verifyRegistrationResponse({
        response: credentialResponse,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.expectedOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      })
    } catch (error) {
      console.warn('Passkey registration verification rejected:', error.message)
      response.status(400).json({ error: { code: 'PASSKEY_REGISTRATION_REJECTED', message: 'The device could not verify this passkey registration. Try again.' } })
      return
    }

    if (!verification.verified || !verification.registrationInfo?.userVerified) {
      response.status(400).json({ error: { code: 'PASSKEY_REGISTRATION_REJECTED', message: 'The device did not confirm user verification. Try again.' } })
      return
    }

    const { credential } = verification.registrationInfo
    await prisma.passkeyCredential.create({
      data: {
        userId: request.auth.userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
      },
    })

    response.status(201).json({ data: { hasPasskey: true } })
  } catch (error) {
    next(error)
  }
})

router.post('/passkeys/recovery/options', authLimiter, async (request, response, next) => {
  try {
    const config = getWebAuthnConfig(request.headers.origin)
    if (!config) {
      response.status(400).json({ error: { code: 'INVALID_WEBAUTHN_ORIGIN', message: 'Passkey recovery must start from a configured app origin.' } })
      return
    }

    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      userVerification: 'required',
    })
    const challengeId = randomUUID()

    await prisma.webAuthnChallenge.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    })
    await prisma.webAuthnChallenge.create({
      data: {
        id: challengeId,
        purpose: 'recovery',
        challenge: options.challenge,
        expiresAt: createChallengeExpiry(),
      },
    })

    response.status(200).json({
      data: {
        challengeId,
        options,
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/passkeys/recovery/verify', authLimiter, async (request, response, next) => {
  try {
    const config = getWebAuthnConfig(request.headers.origin)
    const challengeId = typeof request.body?.challengeId === 'string' ? request.body.challengeId : ''
    const assertion = request.body?.response
    if (!config || !challengeId || !assertion || typeof assertion.id !== 'string') {
      response.status(400).json({ error: { code: 'INVALID_PASSKEY_RESPONSE', message: 'The passkey response is incomplete or came from an unrecognized app origin.' } })
      return
    }

    const challenge = await prisma.webAuthnChallenge.findFirst({
      where: {
        id: challengeId,
        purpose: 'recovery',
        expiresAt: { gt: new Date() },
      },
    })
    if (!challenge) {
      response.status(401).json({ error: { code: 'PASSKEY_CHALLENGE_EXPIRED', message: 'Passkey verification expired. Start again.' } })
      return
    }

    const claim = await prisma.webAuthnChallenge.deleteMany({
      where: {
        id: challenge.id,
        challenge: challenge.challenge,
        purpose: 'recovery',
        expiresAt: { gt: new Date() },
      },
    })
    if (claim.count !== 1) {
      response.status(401).json({ error: { code: 'PASSKEY_CHALLENGE_EXPIRED', message: 'Passkey verification expired. Start again.' } })
      return
    }

    const storedCredential = await prisma.passkeyCredential.findUnique({
      where: { credentialId: assertion.id },
      include: {
        user: { include: { profile: true } },
      },
    })
    if (!storedCredential) {
      response.status(401).json({ error: { code: 'PASSKEY_NOT_RECOGNIZED', message: 'No matching passkey was found. Sign in and set up a passkey for this account first.' } })
      return
    }

    let verification
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.expectedOrigin,
        expectedRPID: config.rpID,
        credential: {
          id: storedCredential.credentialId,
          publicKey: new Uint8Array(storedCredential.publicKey),
          counter: storedCredential.counter,
          transports: storedCredential.transports,
        },
        requireUserVerification: true,
      })
    } catch (error) {
      console.warn('Passkey recovery verification rejected:', error.message)
      response.status(401).json({ error: { code: 'PASSKEY_VERIFICATION_FAILED', message: 'Passkey verification failed. Try again.' } })
      return
    }

    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      response.status(401).json({ error: { code: 'PASSKEY_VERIFICATION_FAILED', message: 'Passkey verification failed. Try again.' } })
      return
    }

    const { user } = storedCredential
    const token = createRecoveryToken()
    await prisma.$transaction(async (tx) => {
      await tx.passkeyCredential.update({
        where: { id: storedCredential.id },
        data: { counter: verification.authenticationInfo.newCounter },
      })
      await tx.passwordResetToken.deleteMany({
        where: { userId: user.id },
      })
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashRecoveryToken(token),
          expiresAt: new Date(Date.now() + RECOVERY_TOKEN_TTL_MS),
        },
      })
    })

    response.status(200).json({
      data: {
        token,
        profile: {
          name: user.profile?.name ?? user.username,
          username: user.username,
          profilePicture: user.profile?.profilePicture ?? null,
        },
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
