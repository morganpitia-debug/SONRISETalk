import { randomUUID } from 'node:crypto'
import { Server } from 'socket.io'
import { AccessToken } from 'livekit-server-sdk'
import { getAuthenticatedSession } from '../auth/session.js'
import { config } from '../config.js'
import { prisma } from '../db.js'
import { addOnlineSocket, getOnlineUserIds, isUserOnline, removeOnlineSocket } from './presence.js'
import { getCallEndStatus, getCallPeerId, isValidCallActivity, isValidCallSignal } from './callPolicy.js'
import { isAllowedOrigin } from './originPolicy.js'
import { mediaOwnershipPrefix } from '../media/mediaService.js'
import { sendIncomingCallPush } from '../push/pushService.js'

const MESSAGE_LIMIT = 4000
const ACTIVE_CALL_STATUSES = ['ringing', 'connected']
const CALL_RING_TIMEOUT_MS = 45000
const CALL_SIGNAL_LIMIT_BYTES = 65536
const CALL_SIGNAL_RATE_LIMIT = 120
const CALL_SIGNAL_WINDOW_MS = 60000
const MAX_ACTIVE_GROUP_CALL_PARTICIPANTS = 16
let realtimeServer = null
const signalActivityByUser = new Map()
const callStartsByUser = new Map()
const callControlsByUser = new Map()
const callActivityByUser = new Map()

function allowedAtRate(map, userId, limit, windowMs) {
  const now = Date.now()
  const recent = (map.get(userId) ?? []).filter((timestamp) => now - timestamp < windowMs)
  if (recent.length >= limit) {
    map.set(userId, recent)
    return false
  }
  recent.push(now)
  map.set(userId, recent)
  return true
}

export function conversationRoom(conversationId) {
  return `conversation:${conversationId}`
}

function callRoom(callId) {
  return `call:${callId}`
}

export function getRealtimeServer() {
  return realtimeServer
}

export function disconnectSessionConnections(sessionId) {
  if (!realtimeServer) return
  for (const socket of realtimeServer.sockets.sockets.values()) {
    if (socket.data.auth?.sessionId === sessionId) socket.disconnect(true)
  }
}

export function disconnectOtherUserSessions(userId, exceptSessionId) {
  if (!realtimeServer) return
  for (const socket of realtimeServer.sockets.sockets.values()) {
    const auth = socket.data.auth
    if (auth?.userId === userId && auth.sessionId !== exceptSessionId) socket.disconnect(true)
  }
}

export function userRoom(userId) {
  return `user:${userId}`
}

function replyError(ack, code, message) {
  ack?.({ error: { code, message } })
}

function serializeMessage(message) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: message.sender.profile?.name ?? message.sender.username,
    content: message.content,
    contextLabel: message.contextLabel ?? null,
    createdAt: message.createdAt.toISOString(),
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    readAt: message.readAt?.toISOString() ?? null,
    voiceNoteUrl: message.voiceNoteUrl ?? null,
    voiceNoteMimeType: message.voiceNoteMimeType ?? null,
    imageUrl: message.imageUrl ?? null,
    imageAssetId: message.imageAssetId ?? null,
  }
}

async function conversationForMember(conversationId, userId) {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      members: { some: { userId } },
    },
    include: {
      members: { select: { userId: true, muted: true } },
    },
  })
}

function otherMemberId(conversation, userId) {
  return conversation.members.find((member) => member.userId !== userId)?.userId
}

async function finishEmptyGroupCall(callId, io) {
  const activeParticipants = await prisma.callParticipant.count({
    where: { callId, leftAt: null },
  })
  if (activeParticipants) return
  const call = await prisma.call.findFirst({
    where: {
      id: callId,
      status: 'connected',
      conversation: { groupName: { not: null } },
    },
    include: { conversation: { select: { members: { select: { userId: true } } } } },
  })
  if (!call) return
  const endedAt = new Date()
  const updated = await prisma.call.updateMany({
    where: { id: call.id, status: 'connected' },
    data: { status: 'completed', endedAt },
  })
  if (!updated.count) return
  const data = { callId: call.id, status: 'completed', endedAt: endedAt.toISOString() }
  for (const member of call.conversation.members) io.to(userRoom(member.userId)).emit('call:ended', data)
}

export function attachSocketServer(httpServer, { clientUrl }) {
  const clientUrls = Array.isArray(clientUrl) ? clientUrl : [clientUrl]
  const io = new Server(httpServer, {
    cors: {
      origin: clientUrls,
      credentials: true,
    },
    allowRequest(request, callback) {
      callback(null, isAllowedOrigin(request, clientUrls))
    },
  })
  realtimeServer = io

  prisma.call.updateMany({
    where: {
      status: { in: ACTIVE_CALL_STATUSES },
      OR: [
        { status: 'ringing', startedAt: { lt: new Date(Date.now() - CALL_RING_TIMEOUT_MS) } },
        { status: 'connected' },
      ],
    },
    data: { status: 'failed', endedAt: new Date() },
  }).catch((error) => console.error('Could not expire stale calls:', error))

  io.use(async (socket, next) => {
    try {
      const auth = await getAuthenticatedSession({
        headers: socket.handshake.headers,
        socketToken: socket.handshake.auth?.token,
      })
      if (!auth) {
        next(new Error('UNAUTHENTICATED'))
        return
      }
      socket.data.auth = auth
      next()
    } catch (error) {
      next(error)
    }
  })

  io.on('connection', (socket) => {
    const { userId } = socket.data.auth
    socket.join(userRoom(userId))
    const firstConnection = addOnlineSocket(userId, socket.id)
    socket.emit('presence:snapshot', { onlineUserIds: getOnlineUserIds() })
    if (firstConnection) io.emit('presence:update', { userId, online: true, lastSeenAt: null })
    prisma.call.findMany({
      where: { recipientId: userId, status: 'ringing', startedAt: { gt: new Date(Date.now() - CALL_RING_TIMEOUT_MS) } },
      include: { initiator: { include: { profile: true } } },
    }).then((calls) => {
      for (const call of calls) {
        socket.emit('call:incoming', {
          id: call.id,
          conversationId: call.conversationId,
          initiatorId: call.initiatorId,
          recipientId: call.recipientId,
          caller: {
            id: call.initiator.id,
            username: call.initiator.username,
            name: call.initiator.profile?.name ?? call.initiator.username,
            profilePicture: call.initiator.profile?.profilePicture ?? null,
          },
          mediaType: call.mediaType,
          status: call.status,
          startedAt: call.startedAt.toISOString(),
        })
      }
    }).catch((error) => console.error('Could not restore incoming calls:', error))
    prisma.call.findMany({
      where: {
        status: 'connected',
        conversation: {
          groupName: { not: null },
          members: { some: { userId } },
        },
      },
      include: {
        initiator: { include: { profile: true } },
        conversation: { select: { groupName: true } },
      },
    }).then((calls) => {
      for (const call of calls) {
        socket.emit('call:group-incoming', {
          id: call.id,
          conversationId: call.conversationId,
          initiatorId: call.initiatorId,
          caller: {
            id: call.initiator.id,
            username: call.initiator.username,
            name: call.initiator.profile?.name ?? call.initiator.username,
            profilePicture: call.initiator.profile?.profilePicture ?? null,
          },
          isHost: call.initiatorId === userId,
          groupName: call.conversation.groupName,
          mediaType: call.mediaType,
          status: call.status,
          startedAt: call.startedAt.toISOString(),
          callMode: 'group',
        })
      }
    }).catch((error) => console.error('Could not restore group call invitations:', error))

    socket.on('conversation:join', async (payload, ack) => {
      try {
        const conversationId = typeof payload === 'string' ? payload : payload?.conversationId
        if (typeof conversationId !== 'string') {
          replyError(ack, 'INVALID_CONVERSATION', 'Choose a valid conversation.')
          return
        }
        const conversation = await conversationForMember(conversationId, userId)
        if (!conversation) {
          replyError(ack, 'CONVERSATION_NOT_FOUND', 'This conversation is unavailable.')
          return
        }
        socket.join(conversationRoom(conversationId))
        ack?.({ data: { joined: true } })
      } catch {
        replyError(ack, 'CONVERSATION_FAILED', 'The conversation could not be opened.')
      }
    })

    socket.on('conversation:leave', (payload) => {
      if (typeof payload?.conversationId === 'string') socket.leave(conversationRoom(payload.conversationId))
    })

    socket.on('message:send', async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId
        const content = typeof payload?.content === 'string' ? payload.content.trim() : ''
        const contextLabel = payload?.contextLabel === 'story_reply' ? payload.contextLabel : null
        const image = payload?.image
        if (typeof conversationId !== 'string' || content.length > MESSAGE_LIMIT
          || (!content && !image)) {
          replyError(ack, 'VALIDATION_ERROR', `Messages must contain text up to ${MESSAGE_LIMIT} characters or an image.`)
          return
        }
        let imageUrl = null
        let imageAssetId = null
        if (image) {
          if (typeof image.assetId !== 'string' || !image.assetId.startsWith(mediaOwnershipPrefix(userId))
            || typeof image.url !== 'string') {
            replyError(ack, 'INVALID_IMAGE', 'Choose an image uploaded to your account.')
            return
          }
          let parsedUrl
          try {
            parsedUrl = new URL(image.url)
          } catch {
            replyError(ack, 'INVALID_IMAGE', 'Choose a valid uploaded image.')
            return
          }
          if (parsedUrl.protocol !== 'https:' || image.mediaType !== 'image') {
            replyError(ack, 'INVALID_IMAGE', 'Choose a valid uploaded image.')
            return
          }
          imageUrl = parsedUrl.toString()
          imageAssetId = image.assetId
        }
        const conversation = await conversationForMember(conversationId, userId)
        if (!conversation) {
          replyError(ack, 'CONVERSATION_NOT_FOUND', 'This conversation is unavailable.')
          return
        }
        const recipientIds = conversation.members.filter((member) => member.userId !== userId).map((member) => member.userId)
        if (!conversation.groupName) {
          const restricted = await prisma.userSettings.findMany({
            where: { userId: { in: recipientIds }, allowMessagesFrom: 'nobody' },
            select: { userId: true },
          })
          if (restricted.length) {
            replyError(ack, 'MESSAGES_DISABLED', 'One or more recipients are not accepting messages.')
            return
          }
        }
        const deliveredAt = recipientIds.some(isUserOnline) ? new Date() : null
        const message = await prisma.$transaction(async (transaction) => {
          const created = await transaction.message.create({
            data: { conversationId, senderId: userId, content, contextLabel, deliveredAt, imageUrl, imageAssetId },
            include: { sender: { include: { profile: true } } },
          })
          await transaction.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: created.createdAt },
          })
          const notificationRecipientIds = conversation.members
            .filter((member) => member.userId !== userId && !member.muted)
            .map(({ userId: recipientId }) => recipientId)
          if (notificationRecipientIds.length) {
            await transaction.notification.createMany({
              data: notificationRecipientIds.map((recipientId) => ({
                recipientId,
                actorId: userId,
                type: 'MESSAGE',
                message: (content || (imageUrl ? 'Photo' : '')).slice(0, 500),
                messageId: created.id,
              })),
            })
          }
          return created
        })
        const data = serializeMessage(message)
        io.to(conversationRoom(conversationId)).emit('message:new', data)
        ack?.({ data })
      } catch {
        replyError(ack, 'MESSAGE_FAILED', 'Your message could not be sent.')
      }
    })

    socket.on('message:delete', async (payload, ack) => {
      try {
        const { conversationId, messageId } = payload || {}
        if (typeof conversationId !== 'string' || typeof messageId !== 'string') {
          replyError(ack, 'INVALID_MESSAGE', 'Choose a valid message to delete.')
          return
        }
        const conversation = await conversationForMember(conversationId, userId)
        const message = conversation
          ? await prisma.message.findFirst({
              where: { id: messageId, conversationId, senderId: userId },
              select: { id: true },
            })
          : null
        if (!conversation || !message) {
          replyError(ack, 'MESSAGE_DELETE_FORBIDDEN', 'Only the sender can delete their own message for everyone.')
          return
        }

        await prisma.$transaction(async (transaction) => {
          await transaction.message.delete({ where: { id: message.id } })
          const latestMessage = await transaction.message.findFirst({
            where: { conversationId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { createdAt: true },
          })
          const conversationRecord = await transaction.conversation.findUnique({
            where: { id: conversationId },
            select: { createdAt: true },
          })
          await transaction.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: latestMessage?.createdAt ?? conversationRecord.createdAt },
          })
        })

        const event = { conversationId, messageId }
        conversation.members.forEach(({ userId: memberId }) => {
          io.to(userRoom(memberId)).emit('message:deleted', event)
        })
        ack?.({ data: event })
      } catch (error) {
        console.error('Could not delete message for everyone:', error)
        replyError(ack, 'MESSAGE_DELETE_FAILED', 'The message could not be deleted for everyone.')
      }
    })

    socket.on('conversation:typing', async (payload) => {
      try {
        const conversationId = payload?.conversationId
        if (typeof conversationId !== 'string' || typeof payload?.typing !== 'boolean') return
        const conversation = await conversationForMember(conversationId, userId)
        if (!conversation) return
        socket.to(conversationRoom(conversationId)).emit('conversation:typing', {
          conversationId,
          userId,
          typing: payload.typing,
        })
      } catch {
        socket.emit('realtime:error', { message: 'Typing state could not be updated.' })
      }
    })

    socket.on('conversation:read', async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId
        if (typeof conversationId !== 'string') {
          replyError(ack, 'INVALID_CONVERSATION', 'Choose a valid conversation.')
          return
        }
        const conversation = await conversationForMember(conversationId, userId)
        if (!conversation) {
          replyError(ack, 'CONVERSATION_NOT_FOUND', 'This conversation is unavailable.')
          return
        }
        const readAt = new Date()
        await prisma.$transaction([
          prisma.conversationMember.updateMany({
            where: { conversationId, userId },
            data: { lastReadAt: readAt },
          }),
          prisma.message.updateMany({
            where: { conversationId, senderId: { not: userId }, readAt: null },
            data: { readAt },
          }),
        ])
        io.to(conversationRoom(conversationId)).emit('conversation:read', { conversationId, userId, readAt: readAt.toISOString() })
        ack?.({ data: { readAt: readAt.toISOString() } })
      } catch {
        replyError(ack, 'READ_FAILED', 'Messages could not be marked as read.')
      }
    })

    socket.on('call:start', async (payload, ack) => {
      try {
        if (!allowedAtRate(callStartsByUser, userId, 10, 15 * 60 * 1000)) {
          replyError(ack, 'CALL_RATE_LIMITED', 'Too many call attempts. Try again later.')
          return
        }
        const { conversationId, mediaType } = payload ?? {}
        if (typeof conversationId !== 'string' || !['audio', 'video'].includes(mediaType)) {
          replyError(ack, 'INVALID_CALL', 'Choose a conversation and call type.')
          return
        }
        const conversation = await conversationForMember(conversationId, userId)
        const isGroupCall = Boolean(conversation?.groupName && conversation.members.length > 2)
        if (!conversation || (!isGroupCall && conversation.members.length !== 2)) {
          replyError(ack, 'CALL_UNAVAILABLE', 'Calls are currently available for one-to-one conversations.')
          return
        }
        if (isGroupCall && !config.livekit) {
          replyError(ack, 'GROUP_CALL_UNAVAILABLE', 'Group calling is not configured. Contact the administrator to configure the LiveKit media server.')
          return
        }
        const recipientId = isGroupCall ? userId : otherMemberId(conversation, userId)
        const activeCall = await prisma.call.findFirst({
          where: {
            status: { in: ACTIVE_CALL_STATUSES },
            OR: [
              { initiatorId: userId },
              { recipientId: userId },
              { conversation: { groupName: { not: null }, members: { some: { userId } } } },
            ],
          },
          select: { id: true },
        })
        if (activeCall) {
          replyError(ack, 'CALL_BUSY', 'There is already an active call in this conversation.')
          return
        }
        const acceptedAt = isGroupCall ? new Date() : null
        const call = await prisma.call.create({
          data: {
            conversationId,
            initiatorId: userId,
            recipientId,
            mediaType,
            status: isGroupCall ? 'connected' : 'ringing',
            ...(acceptedAt ? {
              acceptedAt,
              participants: { create: { userId, joinedAt: acceptedAt } },
            } : {}),
          },
        })
        const caller = await prisma.user.findUnique({
          where: { id: userId },
          include: { profile: true },
        })
        if (!caller) throw new Error('Call initiator account is unavailable.')
        const data = {
          id: call.id,
          conversationId,
          initiatorId: userId,
          recipientId,
          caller: {
            id: userId,
            username: caller.username,
            name: caller.profile?.name ?? caller.username,
            profilePicture: caller.profile?.profilePicture ?? null,
          },
          groupName: isGroupCall ? conversation.groupName : undefined,
          mediaType,
          status: call.status,
          startedAt: call.startedAt.toISOString(),
          ...(isGroupCall ? { callMode: 'group', acceptedAt: acceptedAt.toISOString() } : {}),
        }
        if (isGroupCall) {
          for (const member of conversation.members) {
            if (member.userId !== userId) io.to(userRoom(member.userId)).emit('call:group-incoming', data)
          }
        } else {
          io.to(userRoom(recipientId)).emit('call:incoming', data)
          void sendIncomingCallPush(recipientId, data)
        }
        if (isGroupCall) {
          ack?.({ data })
          return
        }
        const timeout = setTimeout(async () => {
          try {
            const expired = await prisma.call.updateMany({
              where: { id: call.id, status: 'ringing' },
              data: { status: 'missed', endedAt: new Date() },
            })
            if (expired.count) {
              io.to(userRoom(userId)).emit('call:ended', { callId: call.id, status: 'missed' })
              io.to(userRoom(recipientId)).emit('call:ended', { callId: call.id, status: 'missed' })
            }
          } catch (error) {
            console.error('Could not expire ringing call:', error)
          }
        }, CALL_RING_TIMEOUT_MS)
        timeout.unref?.()
        ack?.({ data })
      } catch (error) {
        console.error('Could not start a call:', error)
        replyError(ack, 'CALL_FAILED', 'The call could not be started.')
      }
    })

    socket.on('call:accept', async (payload, ack) => {
      try {
        if (!allowedAtRate(callControlsByUser, userId, 30, 60 * 1000)) {
          replyError(ack, 'CALL_RATE_LIMITED', 'Too many call actions. Try again later.')
          return
        }
        const call = await prisma.call.findFirst({
          where: { id: payload?.callId, recipientId: userId, status: 'ringing' },
        })
        if (!call) {
          replyError(ack, 'CALL_NOT_FOUND', 'This incoming call is no longer available.')
          return
        }
        const acceptedAt = new Date()
        const updated = await prisma.call.updateMany({
          where: { id: call.id, recipientId: userId, status: 'ringing' },
          data: { status: 'connected', acceptedAt },
        })
        if (!updated.count) {
          replyError(ack, 'CALL_NOT_FOUND', 'This incoming call is no longer available.')
          return
        }
        const data = { callId: call.id, status: 'connected', acceptedAt: acceptedAt.toISOString() }
        io.to(userRoom(call.initiatorId)).emit('call:accepted', data)
        ack?.({ data })
      } catch (error) {
        console.error('Could not accept a call:', error)
        replyError(ack, 'CALL_FAILED', 'The call could not be accepted.')
      }
    })

    socket.on('call:group-join', async (payload, ack) => {
      try {
        if (!allowedAtRate(callControlsByUser, userId, 20, 60 * 1000)) {
          replyError(ack, 'CALL_RATE_LIMITED', 'Too many call actions. Try again later.')
          return
        }
        if (!config.livekit) {
          replyError(ack, 'GROUP_CALL_UNAVAILABLE', 'Group calling is not configured on this server.')
          return
        }
        const call = await prisma.call.findFirst({
          where: {
            id: payload?.callId,
            status: 'connected',
            conversation: { groupName: { not: null }, members: { some: { userId } } },
          },
          include: {
            conversation: { include: { members: { select: { userId: true } } } },
            participants: { where: { leftAt: null }, select: { userId: true } },
          },
        })
        if (!call) {
          replyError(ack, 'CALL_NOT_FOUND', 'This group call is no longer available to you.')
          return
        }
        const alreadyJoined = call.participants.some((participant) => participant.userId === userId)
        if (!alreadyJoined && call.participants.length >= MAX_ACTIVE_GROUP_CALL_PARTICIPANTS) {
          replyError(ack, 'CALL_FULL', 'This group call has reached its participant limit.')
          return
        }
        const user = await prisma.user.findUnique({
          where: { id: userId },
          include: { profile: true },
        })
        if (!user) {
          replyError(ack, 'CALL_PARTICIPANT_NOT_FOUND', 'Your account could not be verified for this call.')
          return
        }
        const joinedAt = new Date()
        await prisma.callParticipant.upsert({
          where: { callId_userId: { callId: call.id, userId } },
          create: { callId: call.id, userId, socketId: socket.id, joinedAt },
          update: { socketId: socket.id, joinedAt, leftAt: null },
        })
        socket.join(callRoom(call.id))
        const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
          identity: userId,
          name: user.profile?.name ?? user.username,
          ttl: '10m',
        })
        token.addGrant({ roomJoin: true, room: `sonrise-call-${call.id}`, canPublish: true, canSubscribe: true })
        const jwt = await token.toJwt()
        const activeCall = await prisma.call.findFirst({
          where: { id: call.id, status: 'connected' },
          select: { id: true },
        })
        if (!activeCall) {
          await prisma.callParticipant.updateMany({
            where: { callId: call.id, userId, socketId: socket.id, leftAt: null },
            data: { leftAt: new Date(), socketId: null },
          })
          socket.leave(callRoom(call.id))
          replyError(ack, 'CALL_NOT_FOUND', 'This group call has already ended.')
          return
        }
        const participants = await prisma.callParticipant.findMany({
          where: { callId: call.id, leftAt: null },
          include: { user: { include: { profile: true } } },
        })
        const participant = {
          userId,
          name: user.profile?.name ?? user.username,
          profilePicture: user.profile?.profilePicture ?? null,
        }
        if (!alreadyJoined) {
          io.to(callRoom(call.id)).except(socket.id).emit('call:participant-joined', {
            callId: call.id,
            participant,
          })
        }
        ack?.({
          data: {
            callId: call.id,
            url: config.livekit.url,
            token: jwt,
            participants: participants.map(({ user: participantUser }) => ({
              userId: participantUser.id,
              name: participantUser.profile?.name ?? participantUser.username,
              profilePicture: participantUser.profile?.profilePicture ?? null,
            })),
          },
        })
      } catch (error) {
        console.error('Could not join group call:', error)
        replyError(ack, 'CALL_JOIN_FAILED', 'The group call could not be joined.')
      }
    })

    socket.on('call:group-decline', async (payload, ack) => {
      try {
        const call = await prisma.call.findFirst({
          where: {
            id: payload?.callId,
            status: 'connected',
            conversation: { groupName: { not: null }, members: { some: { userId } } },
          },
          select: { id: true, initiatorId: true },
        })
        if (!call) {
          replyError(ack, 'CALL_NOT_FOUND', 'This group call invitation is no longer available.')
          return
        }
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { username: true, profile: { select: { name: true } } },
        })
        io.to(userRoom(call.initiatorId)).emit('call:group-declined', {
          callId: call.id,
          userId,
          name: user?.profile?.name ?? user?.username ?? 'A group member',
        })
        ack?.({ data: { declined: true } })
      } catch (error) {
        console.error('Could not decline group call:', error)
        replyError(ack, 'CALL_DECLINE_FAILED', 'The group call invitation could not be declined.')
      }
    })

    socket.on('call:group-leave', async (payload, ack) => {
      try {
        const participant = await prisma.callParticipant.findFirst({
          where: {
            callId: payload?.callId,
            userId,
            leftAt: null,
            socketId: socket.id,
            call: { status: 'connected', conversation: { groupName: { not: null } } },
          },
          select: { id: true, callId: true },
        })
        if (!participant) {
          replyError(ack, 'CALL_NOT_FOUND', 'You are not in this active group call.')
          return
        }
        const leftAt = new Date()
        await prisma.callParticipant.update({ where: { id: participant.id }, data: { leftAt, socketId: null } })
        socket.leave(callRoom(participant.callId))
        io.to(callRoom(participant.callId)).emit('call:participant-left', {
          callId: participant.callId,
          userId,
          leftAt: leftAt.toISOString(),
        })
        await finishEmptyGroupCall(participant.callId, io)
        ack?.({ data: { leftAt: leftAt.toISOString() } })
      } catch (error) {
        console.error('Could not leave group call:', error)
        replyError(ack, 'CALL_LEAVE_FAILED', 'The group call could not be left cleanly.')
      }
    })

    socket.on('call:group-end', async (payload, ack) => {
      try {
        const call = await prisma.call.findFirst({
          where: {
            id: payload?.callId,
            initiatorId: userId,
            status: 'connected',
            conversation: { groupName: { not: null } },
          },
          include: { conversation: { select: { members: { select: { userId: true } } } } },
        })
        if (!call) {
          replyError(ack, 'CALL_END_FORBIDDEN', 'Only the call starter can end this group call for everyone.')
          return
        }
        const endedAt = new Date()
        const updated = await prisma.call.updateMany({
          where: { id: call.id, status: 'connected', initiatorId: userId },
          data: { status: 'completed', endedAt },
        })
        if (!updated.count) {
          replyError(ack, 'CALL_NOT_FOUND', 'This group call has already ended.')
          return
        }
        await prisma.callParticipant.updateMany({
          where: { callId: call.id, leftAt: null },
          data: { leftAt: endedAt, socketId: null },
        })
        const data = { callId: call.id, status: 'completed', endedAt: endedAt.toISOString() }
        for (const member of call.conversation.members) io.to(userRoom(member.userId)).emit('call:ended', data)
        ack?.({ data: { status: data.status, endedAt: data.endedAt } })
      } catch (error) {
        console.error('Could not end group call:', error)
        replyError(ack, 'CALL_END_FAILED', 'The group call could not be ended.')
      }
    })

    socket.on('call:signal', async (payload, ack) => {
      try {
        const call = await prisma.call.findFirst({
          where: { id: payload?.callId, status: 'connected', conversation: { groupName: null } },
          select: { id: true, initiatorId: true, recipientId: true },
        })
        const signal = payload?.signal
        if (!allowedAtRate(signalActivityByUser, userId, CALL_SIGNAL_RATE_LIMIT, CALL_SIGNAL_WINDOW_MS)) {
          replyError(ack, 'CALL_SIGNAL_RATE_LIMITED', 'Too many call network updates. Reconnecting…')
          return
        }
        const targetId = call ? getCallPeerId(call, userId) : null
        if (!call || !targetId || !isValidCallSignal(signal, CALL_SIGNAL_LIMIT_BYTES)) {
          replyError(ack, 'CALL_NOT_FOUND', 'This call is no longer available.')
          return
        }
        if (!isUserOnline(targetId)) {
          replyError(ack, 'CALL_PARTICIPANT_OFFLINE', 'The other participant is reconnecting.')
          return
        }
        io.to(userRoom(targetId)).emit('call:signal', { callId: call.id, signal })
        ack?.({ data: { delivered: true } })
      } catch (error) {
        console.error('Could not deliver call signaling:', error)
        replyError(ack, 'CALL_SIGNAL_FAILED', 'Call signaling could not be delivered.')
      }
    })

    socket.on('call:activity', async (payload, ack) => {
      try {
        const activity = payload?.activity
        const isChat = activity?.type === 'chat'
        if (!isValidCallActivity(activity)) {
          replyError(ack, 'INVALID_CALL_ACTIVITY', 'This call activity is not supported.')
          return
        }
        if (!allowedAtRate(callActivityByUser, userId, isChat ? 20 : 60, 60 * 1000)) {
          replyError(ack, 'CALL_ACTIVITY_RATE_LIMITED', 'You are sending call updates too quickly.')
          return
        }
        const call = await prisma.call.findFirst({
          where: { id: payload?.callId, status: 'connected' },
          select: {
            id: true,
            initiatorId: true,
            recipientId: true,
            conversation: { select: { groupName: true } },
            participants: { where: { leftAt: null }, select: { userId: true } },
          },
        })
        if (!call) {
          replyError(ack, 'CALL_NOT_FOUND', 'This call is no longer available.')
          return
        }
        const isGroupCall = Boolean(call.conversation.groupName)
        const recipientIds = isGroupCall
          ? call.participants.filter((participant) => participant.userId !== userId).map((participant) => participant.userId)
          : [getCallPeerId(call, userId)].filter(Boolean)
        if (!isGroupCall && (!recipientIds.length || !isUserOnline(recipientIds[0]))) {
          replyError(ack, 'CALL_PARTICIPANT_OFFLINE', 'The other participant is reconnecting.')
          return
        }
        if (isGroupCall && !call.participants.some((participant) => participant.userId === userId)) {
          replyError(ack, 'CALL_NOT_FOUND', 'You are not a participant in this group call.')
          return
        }
        const data = { id: randomUUID(), callId: call.id, userId, activity, createdAt: new Date().toISOString() }
        for (const recipientId of recipientIds) {
          if (isUserOnline(recipientId)) io.to(userRoom(recipientId)).emit('call:activity', data)
        }
        ack?.({ data: { delivered: true, activity: data } })
      } catch (error) {
        console.error('Could not deliver call activity:', error)
        replyError(ack, 'CALL_ACTIVITY_FAILED', 'The call update could not be delivered.')
      }
    })

    socket.on('call:end', async (payload, ack) => {
      try {
        if (!allowedAtRate(callControlsByUser, userId, 30, 60 * 1000)) {
          replyError(ack, 'CALL_RATE_LIMITED', 'Too many call actions. Try again later.')
          return
        }
        const call = await prisma.call.findFirst({
          where: {
            id: payload?.callId,
            status: { in: ACTIVE_CALL_STATUSES },
            conversation: { groupName: null },
          },
        })
        const otherId = call ? getCallPeerId(call, userId) : null
        if (!call || !otherId) {
          replyError(ack, 'CALL_NOT_FOUND', 'This call is no longer active.')
          return
        }
        const status = getCallEndStatus(call, userId, payload?.status)
        if (!status) {
          replyError(ack, 'CALL_NOT_FOUND', 'This call is no longer active.')
          return
        }
        const endedAt = new Date()
        const updated = await prisma.call.updateMany({
          where: { id: call.id, status: { in: ACTIVE_CALL_STATUSES } },
          data: { status, endedAt },
        })
        if (!updated.count) {
          replyError(ack, 'CALL_NOT_FOUND', 'This call is no longer active.')
          return
        }
        const data = { callId: call.id, status, endedAt: endedAt.toISOString() }
        io.to(userRoom(otherId)).emit('call:ended', data)
        io.to(userRoom(userId)).emit('call:ended', data)
        ack?.({ data: { status, endedAt: endedAt.toISOString() } })
      } catch (error) {
        console.error('Could not end a call:', error)
        replyError(ack, 'CALL_FAILED', 'The call could not be ended.')
      }
    })

    socket.on('disconnect', async () => {
      const lastSocket = removeOnlineSocket(userId, socket.id)
      if (lastSocket) {
        const lastSeenAt = new Date()
        try {
          await prisma.user.update({ where: { id: userId }, data: { lastSeenAt } })
          io.emit('presence:update', { userId, online: false, lastSeenAt: lastSeenAt.toISOString() })
        } catch {
          io.emit('realtime:error', { message: 'Presence could not be updated.' })
        }
      }
      const disconnectTimer = setTimeout(async () => {
        try {
          const groupParticipants = await prisma.callParticipant.findMany({
            where: {
              userId,
              socketId: socket.id,
              leftAt: null,
              call: { status: 'connected', conversation: { groupName: { not: null } } },
            },
            select: { id: true, callId: true },
          })
          for (const participant of groupParticipants) {
            const leftAt = new Date()
            const updated = await prisma.callParticipant.updateMany({
              where: { id: participant.id, socketId: socket.id, leftAt: null },
              data: { leftAt, socketId: null },
            })
            if (updated.count) {
              io.to(callRoom(participant.callId)).emit('call:participant-left', {
                callId: participant.callId,
                userId,
                leftAt: leftAt.toISOString(),
              })
              await finishEmptyGroupCall(participant.callId, io)
            }
          }
          if (!lastSocket || isUserOnline(userId)) return
          const calls = await prisma.call.findMany({
            where: {
              status: { in: ACTIVE_CALL_STATUSES },
              OR: [{ initiatorId: userId }, { recipientId: userId }],
              conversation: { groupName: null },
            },
          })
          for (const call of calls) {
            const status = call.status === 'ringing'
              ? call.recipientId === userId ? 'missed' : 'cancelled'
              : 'failed'
            const endedAt = new Date()
            const updated = await prisma.call.updateMany({
              where: { id: call.id, status: { in: ACTIVE_CALL_STATUSES } },
              data: { status, endedAt },
            })
            if (updated.count) {
              const otherId = call.initiatorId === userId ? call.recipientId : call.initiatorId
              io.to(userRoom(otherId)).emit('call:ended', { callId: call.id, status, endedAt: endedAt.toISOString() })
            }
          }
        } catch (error) {
          console.error('Could not close calls after a participant disconnected:', error)
        }
      }, 30000)
      disconnectTimer.unref?.()
    })
  })

  return io
}
