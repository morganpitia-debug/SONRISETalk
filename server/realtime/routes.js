import { createHmac } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../auth/session.js'
import { config } from '../config.js'
import { prisma } from '../db.js'

const router = Router()

router.get('/ice-servers', requireAuth, (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  const iceServers = config.stunUrls.map((url) => ({ urls: [url] }))
  if (config.turn) {
    const expiry = Math.floor(Date.now() / 1000) + config.turn.credentialLifetimeSeconds
    const username = `${expiry}:${request.auth.userId}`
    const credential = createHmac('sha1', config.turn.sharedSecret).update(username).digest('base64')
    iceServers.push({
      urls: config.turn.urls,
      username,
      credential,
    })
  }
  response.status(200).json({
    data: {
      iceServers,
      turnConfigured: Boolean(config.turn),
    },
  })
})

router.get('/calls/history', requireAuth, async (request, response, next) => {
  try {
    const calls = await prisma.call.findMany({
      where: {
        OR: [
          { initiatorId: request.auth.userId },
          { recipientId: request.auth.userId },
          { participants: { some: { userId: request.auth.userId } } },
        ],
      },
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: {
        initiator: { include: { profile: true } },
        recipient: { include: { profile: true } },
        conversation: { select: { groupName: true } },
      },
    })
    response.status(200).json({
      data: {
        calls: calls.map((call) => ({
          id: call.id,
          conversationId: call.conversationId,
          mediaType: call.mediaType,
          status: call.status,
          startedAt: call.startedAt.toISOString(),
          acceptedAt: call.acceptedAt?.toISOString() ?? null,
          endedAt: call.endedAt?.toISOString() ?? null,
          durationSeconds: call.acceptedAt && call.endedAt
            ? Math.max(0, Math.floor((call.endedAt.getTime() - call.acceptedAt.getTime()) / 1000))
            : 0,
          otherParticipant: call.conversation.groupName
            ? { id: call.conversationId, name: call.conversation.groupName, group: true }
            : call.initiatorId === request.auth.userId
            ? { id: call.recipient.id, username: call.recipient.username, name: call.recipient.profile?.name ?? call.recipient.username }
            : { id: call.initiator.id, username: call.initiator.username, name: call.initiator.profile?.name ?? call.initiator.username },
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

export default router
