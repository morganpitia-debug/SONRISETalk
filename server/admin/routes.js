import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { prisma } from '../db.js'
import { requireAuth } from '../auth/session.js'
import { verifyPassword } from '../auth/password.js'
import { requireAdmin } from './adminAuth.js'

const router = Router()
const promoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'ADMIN_PROMOTION_RATE_LIMITED', message: 'Too many admin password attempts. Try again later.' } },
})

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.profile?.name ?? user.username,
    profilePicture: user.profile?.profilePicture ?? null,
    bio: user.profile?.bio ?? '',
    isPrivate: user.settings?.isPrivate === true,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
  }
}

router.use(requireAuth)

router.get('/status', async (request, response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: request.auth.userId },
      select: { isAdmin: true },
    })
    response.status(200).json({
      data: {
        isAdmin: user?.isAdmin === true,
        promotionEnabled: Boolean(process.env.ADMIN_PROMOTION_PASSWORD_HASH),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/promote', promoteLimiter, async (request, response, next) => {
  try {
    const password = request.body?.password
    const passwordHash = process.env.ADMIN_PROMOTION_PASSWORD_HASH
    if (!passwordHash) {
      response.status(503).json({ error: { code: 'ADMIN_PROMOTION_DISABLED', message: 'Admin promotion is not configured on this server.' } })
      return
    }
    if (typeof password !== 'string' || password.length > 256 || !(await verifyPassword(password, passwordHash))) {
      response.status(403).json({ error: { code: 'INVALID_ADMIN_PASSWORD', message: 'The admin password is incorrect.' } })
      return
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: request.auth.userId },
        data: { isAdmin: true },
        select: { id: true },
      })
      await transaction.adminAuditLog.create({
        data: { actorUserId: request.auth.userId, targetUserId: request.auth.userId, action: 'PROMOTE_SELF' },
      })
    })
    response.status(200).json({ data: { isAdmin: true } })
  } catch (error) {
    next(error)
  }
})

router.use(requireAdmin)

router.get('/users', async (request, response, next) => {
  try {
    const rawLimit = Number(request.query.limit ?? 50)
    if (!Number.isInteger(rawLimit) || rawLimit < 1) {
      response.status(400).json({ error: { code: 'INVALID_LIMIT', message: 'The page size must be a positive integer.' } })
      return
    }
    const limit = Math.min(rawLimit, 100)
    const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 80) : ''
    const users = await prisma.user.findMany({
      where: query ? { username: { contains: query.toLowerCase() } } : undefined,
      select: {
        id: true,
        username: true,
        isAdmin: true,
        createdAt: true,
        profile: { select: { name: true, profilePicture: true, bio: true } },
        settings: { select: { isPrivate: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(typeof request.query.cursor === 'string' ? { cursor: { id: request.query.cursor }, skip: 1 } : {}),
      take: limit + 1,
    })
    const hasMore = users.length > limit
    const page = users.slice(0, limit)
    response.status(200).json({
      data: {
        users: page.map(serializeUser),
        nextCursor: hasMore ? page.at(-1).id : null,
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/reports', async (_request, response, next) => {
  try {
    const reports = await prisma.userReport.findMany({
      where: { status: 'open' },
      include: {
        reporter: { include: { profile: true } },
        reportedUser: { include: { profile: true, settings: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })
    response.status(200).json({
      data: {
        reports: reports.map((report) => ({
          id: report.id,
          reason: report.reason,
          details: report.details,
          createdAt: report.createdAt.toISOString(),
          reporter: {
            id: report.reporter.id,
            username: report.reporter.username,
            name: report.reporter.profile?.name ?? report.reporter.username,
          },
          account: serializeUser(report.reportedUser),
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/users/:userId', async (request, response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: request.params.userId },
      include: {
        profile: true,
        settings: true,
        posts: {
          include: {
            media: { orderBy: { position: 'asc' } },
            _count: { select: { likes: true, comments: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
        },
        reportsReceived: {
          where: { status: 'open' },
          include: { reporter: { include: { profile: true } } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        _count: { select: { posts: true, reportsReceived: true } },
      },
    })
    if (!user) {
      response.status(404).json({ error: { code: 'ACCOUNT_NOT_FOUND', message: 'This account could not be found.' } })
      return
    }
    response.status(200).json({
      data: {
        account: {
          ...serializeUser(user),
          postCount: user._count.posts,
          reports: user.reportsReceived.map((report) => ({
            id: report.id,
            reason: report.reason,
            details: report.details,
            createdAt: report.createdAt.toISOString(),
            reporter: {
              id: report.reporter.id,
              username: report.reporter.username,
              name: report.reporter.profile?.name ?? report.reporter.username,
            },
          })),
          posts: user.posts.map((post) => ({
            id: post.id,
            caption: post.caption ?? post.content ?? '',
            createdAt: post.createdAt.toISOString(),
            media: post.media.map((item) => ({ url: item.url, type: item.mediaType })),
            likes: post._count.likes,
            comments: post._count.comments,
          })),
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/reports/:reportId', async (request, response, next) => {
  try {
    const status = request.body?.status
    if (!['reviewed', 'dismissed'].includes(status)) {
      response.status(400).json({ error: { code: 'INVALID_REPORT_STATUS', message: 'Choose reviewed or dismissed.' } })
      return
    }
    const report = await prisma.userReport.findUnique({
      where: { id: request.params.reportId },
      select: { id: true },
    })
    if (!report) {
      response.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'This report could not be found.' } })
      return
    }
    await prisma.$transaction([
      prisma.userReport.update({ where: { id: report.id }, data: { status } }),
      prisma.adminAuditLog.create({
        data: {
          actorUserId: request.auth.userId,
          targetUserId: report.id,
          action: status === 'reviewed' ? 'REVIEW_REPORT' : 'DISMISS_REPORT',
        },
      }),
    ])
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/users/:userId', async (request, response, next) => {
  try {
    const targetId = request.params.userId
    if (targetId === request.auth.userId) {
      response.status(400).json({ error: { code: 'CANNOT_DELETE_SELF', message: 'You cannot delete your own account from the admin panel.' } })
      return
    }
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, isAdmin: true },
    })
    if (!target) {
      response.status(404).json({ error: { code: 'ACCOUNT_NOT_FOUND', message: 'This account could not be found.' } })
      return
    }
    if (target.isAdmin) {
      response.status(403).json({ error: { code: 'CANNOT_DELETE_ADMIN', message: 'Admin accounts cannot be removed from this panel.' } })
      return
    }
    await prisma.$transaction([
      prisma.adminAuditLog.create({
        data: {
          actorUserId: request.auth.userId,
          targetUserId: target.id,
          action: 'DELETE_ACCOUNT',
        },
      }),
      prisma.user.delete({ where: { id: target.id } }),
    ])
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
