import { Router } from 'express'
import { requireAuth } from '../auth/session.js'
import { prisma } from '../db.js'

const router = Router()

function relativeTime(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`
  return date.toLocaleDateString()
}

function serializeNotification(notification) {
  const actor = notification.actor
  const actorName = actor?.profile?.name ?? actor?.username ?? 'Someone'
  const type = notification.type === 'FOLLOW_REQUEST' ? 'FOLLOW' : notification.type
  const detail = notification.message
  const target = notification.postId ? 'post'
    : notification.storyId ? 'story'
      : notification.messageId ? 'message'
        : type === 'FOLLOW' ? 'profile' : 'post'
  return {
    id: notification.id,
    type,
    person: actorName,
    profileId: actor?.id ?? null,
    username: actor?.username ?? null,
    initials: (actor?.username ?? actorName).replace(/^@/, '').charAt(0).toUpperCase(),
    profilePicture: actor?.profile?.profilePicture ?? null,
    tone: 'amber',
    action: detail || (type === 'FOLLOW' ? 'started following you' : type.toLowerCase()),
    quote: type === 'COMMENT' && detail ? `“${detail}”` : '',
    title: notification.post?.caption || notification.post?.content || '',
    detail: notification.post?.content || '',
    target,
    time: relativeTime(notification.createdAt),
    read: Boolean(notification.readAt),
    section: Date.now() - notification.createdAt.getTime() < 24 * 60 * 60 * 1000 ? 'Today' : 'Earlier',
    followStatus: notification.followStatus,
    createdAt: notification.createdAt.toISOString(),
  }
}

router.use(requireAuth)

router.get('/', async (request, response, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { recipientId: request.auth.userId },
      include: {
        actor: { include: { profile: true } },
        post: { select: { content: true, caption: true } },
        story: { select: { id: true } },
        messageRef: { select: { id: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    })
    const actorIds = notifications
      .filter((item) => item.type === 'FOLLOW' || item.type === 'FOLLOW_REQUEST')
      .map((item) => item.actorId)
      .filter(Boolean)
    const followStatuses = actorIds.length ? await prisma.follow.findMany({
      where: { followerId: { in: actorIds }, followingId: request.auth.userId },
      select: { followerId: true, status: true },
    }) : []
    const statusByActor = new Map(followStatuses.map((item) => [item.followerId, item.status]))
    response.status(200).json({
      data: {
        notifications: notifications.map((item) => serializeNotification({
          ...item,
          followStatus: statusByActor.get(item.actorId) === 'requested' ? 'pending'
            : statusByActor.get(item.actorId) === 'accepted' ? 'accepted' : undefined,
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/:notificationId/read', async (request, response, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { id: request.params.notificationId, recipientId: request.auth.userId, readAt: null },
      data: { readAt: new Date() },
    })
    if (!result.count) {
      const exists = await prisma.notification.findFirst({
        where: { id: request.params.notificationId, recipientId: request.auth.userId },
        select: { id: true },
      })
      if (!exists) {
        response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'This notification could not be found.' } })
        return
      }
    }
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.patch('/read-all', async (request, response, next) => {
  try {
    await prisma.notification.updateMany({
      where: { recipientId: request.auth.userId, readAt: null },
      data: { readAt: new Date() },
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
