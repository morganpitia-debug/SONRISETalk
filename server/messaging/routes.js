import { Router } from 'express'
import multer from 'multer'
import { rateLimit } from 'express-rate-limit'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { requireAuth } from '../auth/session.js'
import { prisma } from '../db.js'
import {
  createUploadDirectory,
  deleteVoiceNoteFromCloudinary,
  fetchVoiceNoteFromCloudinary,
  hasValidVoiceNoteSignature,
  isAllowedVoiceMimeType,
  mediaOwnershipPrefix,
  removeTemporaryUpload,
  uploadVoiceNoteToCloudinary,
} from '../media/mediaService.js'
import { isUserOnline } from '../realtime/presence.js'
import { conversationRoom, getRealtimeServer, userRoom } from '../realtime/socketServer.js'

const router = Router()
const MAX_PARTICIPANTS = 10
const MESSAGE_PAGE_SIZE = 50
const MAX_VOICE_NOTE_BYTES = 20 * 1024 * 1024
const voiceNoteRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'VOICE_NOTE_RATE_LIMITED', message: 'Too many voice notes. Try again later.' } },
})
const voiceNoteUpload = multer({
  storage: multer.diskStorage({
    destination: async (_request, _file, callback) => {
      try {
        callback(null, await createUploadDirectory())
      } catch (error) {
        callback(error)
      }
    },
  }),
  limits: { fileSize: MAX_VOICE_NOTE_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!isAllowedVoiceMimeType(file.mimetype)) {
      const error = new Error('Choose a supported audio recording.')
      error.status = 400
      error.code = 'UNSUPPORTED_AUDIO_TYPE'
      callback(error)
      return
    }
    callback(null, true)
  },
})

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase()
}

function personView(user) {
  const name = user.profile?.name ?? user.username
  return {
    id: user.id,
    name,
    username: user.username,
    handle: `@${user.username}`,
    initials: initials(user.username),
    profilePicture: user.profile?.profilePicture ?? null,
    online: isUserOnline(user.id),
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
  }
}

async function messageView(message) {
  return {
    id: message.id,
    senderId: message.senderId,
    from: message.senderId === message._viewerId ? 'me' : 'them',
    text: message.content,
    contextLabel: message.contextLabel === 'story_reply'
      ? message.senderId === message._viewerId ? 'You replied to their story' : 'Replied to your story'
      : message.contextLabel ?? null,
    time: new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(message.createdAt),
    createdAt: message.createdAt.toISOString(),
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    readAt: message.readAt?.toISOString() ?? null,
    voiceNoteUrl: message.voiceNoteAssetId
      ? `/api/conversations/${encodeURIComponent(message.conversationId)}/messages/${encodeURIComponent(message.id)}/voice-note`
      : null,
    voiceNoteMimeType: message.voiceNoteMimeType,
    imageUrl: message.imageUrl ?? null,
    imageAssetId: message.imageAssetId ?? null,
  }
}

async function getConversation(conversationId, userId) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, members: { some: { userId } } },
    include: {
      members: {
        include: {
          user: { include: { profile: true, settings: true } },
        },
      },
      messages: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        include: { sender: { include: { profile: true } } },
      },
    },
  })
}

router.use(requireAuth)

router.get('/', async (request, response, next) => {
  try {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId: request.auth.userId },
      include: {
        conversation: {
          include: {
            members: {
              include: { user: { include: { profile: true } } },
            },
            nicknames: { where: { setterUserId: request.auth.userId } },
            messages: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              include: { sender: { include: { profile: true } } },
            },
          },
        },
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
      take: 100,
    })
    const conversations = await Promise.all(memberships.map(async (membership) => {
      const conversation = membership.conversation
      const members = conversation.members.map((item) => personView(item.user))
      const otherMembers = members.filter((member) => member.id !== request.auth.userId)
      const unreadCount = await prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderId: { not: request.auth.userId },
          readAt: null,
          ...(membership.lastReadAt ? { createdAt: { gt: membership.lastReadAt } } : {}),
        },
      })
      const lastMessage = conversation.messages[0]
      return {
        id: conversation.id,
        members,
        groupName: conversation.groupName,
        groupPicture: conversation.groupPicture,
        profilePicture: conversation.groupPicture || (otherMembers.length === 1 ? otherMembers[0].profilePicture : null),
        name: conversation.groupName || (otherMembers.length > 1 ? otherMembers.map((item) => item.name).join(', ') : otherMembers[0]?.name ?? 'Conversation'),
        handle: conversation.groupName ? `${members.length} members` : otherMembers.length === 1 ? otherMembers[0].handle : `${otherMembers.length} members`,
        initials: conversation.groupName ? conversation.groupName.trim().charAt(0).toUpperCase() : otherMembers.length === 1 ? otherMembers[0].initials : 'GR',
        profileId: conversation.groupName ? null : otherMembers[0]?.id ?? null,
        online: conversation.groupName ? otherMembers.some((item) => item.online) : otherMembers.length === 1 ? otherMembers[0].online : otherMembers.some((item) => item.online),
        time: lastMessage ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(lastMessage.createdAt) : '',
        unread: unreadCount,
        lastReadAt: membership.lastReadAt?.toISOString() ?? null,
        muted: membership.muted,
        messages: lastMessage ? [await messageView({ ...lastMessage, _viewerId: request.auth.userId })] : [],
        blocked: false,
        nickname: conversation.nicknames.find((nickname) => nickname.targetUserId === otherMembers[0]?.id)?.nickname ?? null,
      }
    }))
    response.status(200).json({ data: { conversations } })
  } catch (error) {
    next(error)
  }
})

router.put('/:conversationId/mute', async (request, response, next) => {
  try {
    const muted = request.body?.muted
    if (typeof muted !== 'boolean') {
      response.status(400).json({ error: { code: 'INVALID_MUTE_SETTING', message: 'Choose whether to mute this conversation.' } })
      return
    }
    const membership = await prisma.conversationMember.findFirst({
      where: { conversationId: request.params.conversationId, userId: request.auth.userId },
      select: { id: true },
    })
    if (!membership) {
      response.status(404).json({ error: { code: 'CONVERSATION_NOT_FOUND', message: 'This conversation is unavailable.' } })
      return
    }
    await prisma.conversationMember.update({ where: { id: membership.id }, data: { muted } })
    response.status(200).json({ data: { muted } })
  } catch (error) {
    next(error)
  }
})

router.put('/:conversationId/nickname', async (request, response, next) => {
  try {
    const nickname = typeof request.body?.nickname === 'string' ? request.body.nickname.trim() : null
    if (nickname === null || nickname.length > 32) {
      response.status(400).json({ error: { code: 'INVALID_NICKNAME', message: 'Nicknames must be 32 characters or fewer.' } })
      return
    }
    const conversation = await getConversation(request.params.conversationId, request.auth.userId)
    if (!conversation || conversation.members.length !== 2) {
      response.status(404).json({ error: { code: 'CONVERSATION_NOT_FOUND', message: 'This one-to-one conversation is unavailable.' } })
      return
    }
    const target = conversation.members.find((member) => member.userId !== request.auth.userId)
    if (nickname) {
      const permission = target.user.settings?.allowNicknamesFrom ?? 'everyone'
      if (permission === 'nobody') {
        response.status(403).json({ error: { code: 'NICKNAMES_NOT_ALLOWED', message: 'This person does not allow nicknames.' } })
        return
      }
      if (permission === 'following') {
        const follow = await prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: target.userId, followingId: request.auth.userId } },
          select: { status: true },
        })
        if (follow?.status !== 'accepted') {
          response.status(403).json({ error: { code: 'NICKNAMES_NOT_ALLOWED', message: 'This person only allows nicknames from accounts they follow.' } })
          return
        }
      }
    }
    const nicknameWhere = {
      conversationId_setterUserId_targetUserId: {
        conversationId: conversation.id,
        setterUserId: request.auth.userId,
        targetUserId: target.userId,
      },
    }
    if (nickname) {
      await prisma.conversationNickname.upsert({
        where: nicknameWhere,
        create: { ...nicknameWhere.conversationId_setterUserId_targetUserId, nickname },
        update: { nickname },
      })
    } else {
      await prisma.conversationNickname.deleteMany({
        where: { conversationId: conversation.id, setterUserId: request.auth.userId, targetUserId: target.userId },
      })
    }
    response.status(200).json({ data: { nickname: nickname || null } })
  } catch (error) {
    next(error)
  }
})

router.get('/:conversationId/addable-members', async (request, response, next) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: request.params.conversationId,
        groupName: { not: null },
        members: { some: { userId: request.auth.userId } },
      },
      include: { members: { select: { userId: true } } },
    })
    if (!conversation) {
      response.status(404).json({ error: { code: 'GROUP_NOT_FOUND', message: 'This group is unavailable.' } })
      return
    }
    if (conversation.members.length >= MAX_PARTICIPANTS) {
      response.status(200).json({ data: { users: [] } })
      return
    }
    const [following, followers] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: request.auth.userId, status: 'accepted' },
        select: { followingId: true },
      }),
      prisma.follow.findMany({
        where: { followingId: request.auth.userId, status: 'accepted' },
        select: { followerId: true },
      }),
    ])
    const followerIds = new Set(followers.map(({ followerId }) => followerId))
    const mutualIds = following
      .map(({ followingId }) => followingId)
      .filter((userId) => followerIds.has(userId) && !conversation.members.some((member) => member.userId === userId))
    const users = await prisma.user.findMany({
      where: { id: { in: mutualIds } },
      include: { profile: true, settings: true },
      orderBy: { username: 'asc' },
      take: 200,
    })
    response.status(200).json({ data: { users: users.map(personView) } })
  } catch (error) {
    next(error)
  }
})

router.post('/:conversationId/members', async (request, response, next) => {
  try {
    const participantIds = request.body?.participantIds
    if (!Array.isArray(participantIds) || participantIds.length < 1
      || participantIds.some((id) => typeof id !== 'string')
      || new Set(participantIds).size !== participantIds.length
      || participantIds.includes(request.auth.userId)) {
      response.status(400).json({ error: { code: 'INVALID_PARTICIPANTS', message: 'Choose at least one valid person to add.' } })
      return
    }
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: request.params.conversationId,
        groupName: { not: null },
        members: { some: { userId: request.auth.userId } },
      },
      include: { members: { select: { userId: true } } },
    })
    if (!conversation) {
      response.status(404).json({ error: { code: 'GROUP_NOT_FOUND', message: 'This group is unavailable.' } })
      return
    }
    if (conversation.members.length + participantIds.length > MAX_PARTICIPANTS) {
      response.status(400).json({ error: { code: 'GROUP_FULL', message: 'This group can have up to ten members.' } })
      return
    }
    const memberIds = new Set(conversation.members.map(({ userId }) => userId))
    if (participantIds.some((id) => memberIds.has(id))) {
      response.status(409).json({ error: { code: 'ALREADY_GROUP_MEMBER', message: 'One or more selected people are already in this group.' } })
      return
    }
    const users = await prisma.user.findMany({
      where: { id: { in: participantIds } },
      select: { id: true },
    })
    if (users.length !== participantIds.length) {
      response.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'One or more selected accounts could not be found.' } })
      return
    }
    const [following, followers] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: request.auth.userId, followingId: { in: participantIds }, status: 'accepted' },
        select: { followingId: true },
      }),
      prisma.follow.findMany({
        where: { followerId: { in: participantIds }, followingId: request.auth.userId, status: 'accepted' },
        select: { followerId: true },
      }),
    ])
    const followingIds = new Set(following.map(({ followingId }) => followingId))
    const followerIds = new Set(followers.map(({ followerId }) => followerId))
    if (participantIds.some((id) => !followingIds.has(id) || !followerIds.has(id))) {
      response.status(403).json({ error: { code: 'GROUP_MEMBERS_MUST_FOLLOW', message: 'You can add people only when you and they follow each other.' } })
      return
    }
    const added = await prisma.$transaction(async (transaction) => {
      const memberCount = await transaction.conversationMember.count({ where: { conversationId: conversation.id } })
      if (memberCount + participantIds.length > MAX_PARTICIPANTS) return false
      await transaction.conversationMember.createMany({
        data: participantIds.map((userId) => ({ conversationId: conversation.id, userId })),
      })
      return true
    })
    if (!added) {
      response.status(400).json({ error: { code: 'GROUP_FULL', message: 'This group can have up to ten members.' } })
      return
    }
    getRealtimeServer()?.to(conversationRoom(conversation.id)).emit('conversation:members', { conversationId: conversation.id })
    response.status(200).json({ data: { added: participantIds.length } })
  } catch (error) {
    next(error)
  }
})

router.delete('/:conversationId/membership', async (request, response, next) => {
  try {
    const membership = await prisma.conversationMember.findFirst({
      where: {
        conversationId: request.params.conversationId,
        userId: request.auth.userId,
        conversation: { groupName: { not: null } },
      },
      select: { id: true, conversationId: true },
    })
    if (!membership) {
      response.status(404).json({ error: { code: 'GROUP_NOT_FOUND', message: 'This group is unavailable.' } })
      return
    }
    const remainingMembers = await prisma.$transaction(async (transaction) => {
      await transaction.conversationMember.delete({ where: { id: membership.id } })
      const count = await transaction.conversationMember.count({ where: { conversationId: membership.conversationId } })
      if (count === 0) await transaction.conversation.delete({ where: { id: membership.conversationId } })
      return count
    })
    getRealtimeServer()?.to(conversationRoom(membership.conversationId)).emit('conversation:members', { conversationId: membership.conversationId })
    getRealtimeServer()?.to(userRoom(request.auth.userId)).emit('conversation:removed', { conversationId: membership.conversationId })
    response.status(200).json({ data: { left: true, remainingMembers } })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (request, response, next) => {
  try {
    const rawIds = request.body?.participantIds
    const isGroup = Object.hasOwn(request.body ?? {}, 'groupName')
    const groupName = typeof request.body?.groupName === 'string' ? request.body.groupName.trim() : ''
    const groupPicture = request.body?.groupPicture
    if (isGroup && (!groupName || groupName.length > 80 || !Array.isArray(rawIds) || rawIds.length < 2)) {
      response.status(400).json({
        error: { code: 'INVALID_GROUP', message: 'Choose at least two followers and enter a group name of up to 80 characters.' },
      })
      return
    }
    if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length >= MAX_PARTICIPANTS
      || rawIds.some((id) => typeof id !== 'string')
      || new Set(rawIds).size !== rawIds.length
      || rawIds.includes(request.auth.userId)) {
      response.status(400).json({
        error: { code: 'INVALID_PARTICIPANTS', message: `Choose between 1 and ${MAX_PARTICIPANTS - 1} other accounts.` },
      })
      return
    }
    const participantIds = [...rawIds, request.auth.userId]
    const recipients = await prisma.user.findMany({
      where: { id: { in: rawIds } },
      include: { settings: true },
    })
    if (recipients.length !== rawIds.length) {
      response.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'One or more participants could not be found.' } })
      return
    }
    if (isGroup) {
      const [following, followers] = await Promise.all([
        prisma.follow.findMany({
          where: { followerId: request.auth.userId, followingId: { in: rawIds }, status: 'accepted' },
          select: { followingId: true },
        }),
        prisma.follow.findMany({
          where: { followerId: { in: rawIds }, followingId: request.auth.userId, status: 'accepted' },
          select: { followerId: true },
        }),
      ])
      const mutualIds = new Set(following.map(({ followingId }) => followingId))
      const followerIds = new Set(followers.map(({ followerId }) => followerId))
      if (rawIds.some((id) => !mutualIds.has(id) || !followerIds.has(id))) {
        response.status(403).json({ error: { code: 'GROUP_MEMBERS_MUST_FOLLOW', message: 'You and each person added to a group must follow each other.' } })
        return
      }
      if (groupPicture !== undefined && groupPicture !== null) {
        const ownedPrefix = mediaOwnershipPrefix(request.auth.userId)
        if (typeof groupPicture.assetId !== 'string'
          || !groupPicture.assetId.startsWith(ownedPrefix)
          || groupPicture.mediaType !== 'image'
          || typeof groupPicture.url !== 'string'
          || !groupPicture.url.startsWith('https://')) {
          response.status(400).json({ error: { code: 'INVALID_GROUP_PICTURE', message: 'Choose a valid uploaded group image.' } })
          return
        }
      }
    }
    for (const recipient of (isGroup ? [] : recipients)) {
      const allowMessagesFrom = recipient.settings?.allowMessagesFrom ?? 'everyone'
      if (allowMessagesFrom === 'nobody') {
        response.status(403).json({ error: { code: 'MESSAGES_DISABLED', message: 'One or more recipients are not accepting messages.' } })
        return
      }
      if (allowMessagesFrom === 'followers') {
        const follow = await prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: request.auth.userId, followingId: recipient.id } },
          select: { status: true },
        })
        if (follow?.status !== 'accepted') {
          response.status(403).json({ error: { code: 'FOLLOWERS_ONLY', message: 'Follow the recipient before starting a conversation.' } })
          return
        }
      }
    }

    if (participantIds.length === 2) {
      const conversation = await prisma.$transaction(async (transaction) => {
        const existing = await transaction.conversation.findFirst({
          where: {
            groupName: null,
            AND: participantIds.map((userId) => ({ members: { some: { userId } } })),
            members: { every: { userId: { in: participantIds } } },
          },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
        if (existing) return { ...existing, created: false }
        const created = await transaction.conversation.create({
          data: {
            members: {
              create: participantIds.map((userId) => ({ userId })),
            },
          },
          select: { id: true, createdAt: true },
        })
        return { ...created, created: true }
      })
      response.status(conversation.created ? 201 : 200).json({
        data: {
          conversation: {
            id: conversation.id,
            created: conversation.created,
            ...(conversation.created ? { createdAt: conversation.createdAt.toISOString() } : {}),
          },
        },
      })
      return
    }

    const conversation = await prisma.conversation.create({
      data: {
        ...(isGroup ? {
          groupName,
          groupPicture: groupPicture?.url ?? null,
          groupPictureAssetId: groupPicture?.assetId ?? null,
        } : {}),
        members: {
          create: participantIds.map((userId) => ({ userId })),
        },
      },
      select: { id: true, createdAt: true },
    })
    response.status(201).json({ data: { conversation: { id: conversation.id, created: true, createdAt: conversation.createdAt.toISOString() } } })
  } catch (error) {
    next(error)
  }
})

router.post('/:conversationId/voice-notes', voiceNoteRateLimit, voiceNoteUpload.single('audio'), async (request, response, next) => {
  let uploaded
  let persisted = false
  if (!request.file) {
    response.status(400).json({ error: { code: 'AUDIO_REQUIRED', message: 'Record a voice note before sending it.' } })
    return
  }
  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: request.params.conversationId,
        members: { some: { userId: request.auth.userId } },
      },
      include: { members: { select: { userId: true, muted: true } } },
    })
    if (!conversation) {
      response.status(404).json({ error: { code: 'CONVERSATION_NOT_FOUND', message: 'This conversation is unavailable.' } })
      return
    }
    if (!await hasValidVoiceNoteSignature(request.file)) {
      response.status(400).json({ error: { code: 'INVALID_AUDIO_CONTENT', message: 'The uploaded file is not a supported audio recording.' } })
      return
    }
    uploaded = await uploadVoiceNoteToCloudinary(request.file, request.auth.userId)
    const recipientIds = conversation.members.map(({ userId }) => userId).filter((userId) => userId !== request.auth.userId)
    const notificationRecipientIds = conversation.members
      .filter((member) => member.userId !== request.auth.userId && !member.muted)
      .map(({ userId }) => userId)
    const message = await prisma.$transaction(async (transaction) => {
      const created = await transaction.message.create({
        data: {
          conversationId: conversation.id,
          senderId: request.auth.userId,
          content: 'Voice note',
          deliveredAt: recipientIds.some(isUserOnline) ? new Date() : null,
          voiceNoteAssetId: uploaded.assetId,
          voiceNoteMimeType: uploaded.mimeType,
          voiceNoteSizeBytes: uploaded.bytes,
          voiceNoteFormat: uploaded.format,
        },
        include: { sender: { include: { profile: true } } },
      })
      await transaction.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: created.createdAt },
      })
      if (notificationRecipientIds.length) {
        await transaction.notification.createMany({
          data: notificationRecipientIds.map((recipientId) => ({
            recipientId,
            actorId: request.auth.userId,
            type: 'MESSAGE',
            message: 'Voice note',
            messageId: created.id,
          })),
        })
      }
      return created
    })
    persisted = true
    const data = await messageView({ ...message, _viewerId: request.auth.userId })
    getRealtimeServer()?.to(conversationRoom(conversation.id)).emit('message:new', {
      id: message.id,
      conversationId: conversation.id,
      senderId: request.auth.userId,
      senderName: message.sender.profile?.name ?? message.sender.username,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      deliveredAt: message.deliveredAt?.toISOString() ?? null,
      readAt: null,
      voiceNoteUrl: data.voiceNoteUrl,
      voiceNoteMimeType: uploaded.mimeType,
    })
    response.status(201).json({ data: { message: data } })
  } catch (error) {
    if (uploaded?.assetId && !persisted) {
      try {
        await deleteVoiceNoteFromCloudinary(uploaded.assetId)
      } catch (cleanupError) {
        console.error('Could not remove orphaned voice note:', cleanupError)
      }
    }
    next(error)
  } finally {
    await removeTemporaryUpload(request.file.path)
  }
})

router.get('/:conversationId/messages', async (request, response, next) => {
  try {
    const conversation = await getConversation(request.params.conversationId, request.auth.userId)
    if (!conversation) {
      response.status(404).json({ error: { code: 'CONVERSATION_NOT_FOUND', message: 'This conversation is unavailable.' } })
      return
    }
    const before = request.query.before
    let beforeDate
    if (before !== undefined) {
      beforeDate = new Date(String(before))
      if (Number.isNaN(beforeDate.getTime())) {
        response.status(400).json({ error: { code: 'INVALID_CURSOR', message: 'The message history cursor is invalid.' } })
        return
      }
    }
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
      },
      include: { sender: { include: { profile: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MESSAGE_PAGE_SIZE,
    })
    const page = messages.reverse()
    response.status(200).json({
      data: {
        messages: await Promise.all(page.map((message) => messageView({ ...message, _viewerId: request.auth.userId }))),
        nextCursor: messages.length === MESSAGE_PAGE_SIZE ? messages[messages.length - 1].createdAt.toISOString() : null,
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:conversationId/messages/:messageId/voice-note', async (request, response, next) => {
  try {
    const message = await prisma.message.findFirst({
      where: {
        id: request.params.messageId,
        conversationId: request.params.conversationId,
        conversation: { members: { some: { userId: request.auth.userId } } },
        voiceNoteAssetId: { not: null },
      },
      select: { voiceNoteAssetId: true },
    })
    if (!message?.voiceNoteAssetId) {
      response.status(404).json({ error: { code: 'VOICE_NOTE_NOT_FOUND', message: 'This voice note is unavailable.' } })
      return
    }
    const upstream = await fetchVoiceNoteFromCloudinary(message.voiceNoteAssetId)
    response.status(200)
    response.set({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline; filename="voice-note.mp3"',
      'Content-Type': 'audio/mpeg',
      'X-Content-Type-Options': 'nosniff',
    })
    const contentLength = upstream.headers.get('content-length')
    if (contentLength && /^\d+$/.test(contentLength)) response.set('Content-Length', contentLength)
    try {
      await pipeline(Readable.fromWeb(upstream.body), response)
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error)
        return
      }
      throw error
    }
  } catch (error) {
    next(error)
  }
})

export default router
