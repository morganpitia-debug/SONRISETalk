import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { prisma } from '../db.js'
import { requireAuth } from '../auth/session.js'
import { mediaOwnershipPrefix } from '../media/mediaService.js'

const router = Router()
const MAX_PAGE_SIZE = 30
const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000
const MAX_HIGHLIGHT_TITLE_LENGTH = 32
const MAX_HIGHLIGHT_STORIES = 100
const MAX_HIGHLIGHT_COUNT = 50
const MEDIA_TYPES = new Set(['image', 'video'])
const AUDIENCES = new Set(['followers', 'close-friends'])
const REPORT_REASONS = new Set(['spam', 'harassment', 'impersonation', 'inappropriate', 'other'])
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'REPORT_RATE_LIMITED', message: 'Too many reports. Try again later.' } },
})

function requestError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function parseLimit(value) {
  const limit = Number(value ?? 20)
  if (!Number.isInteger(limit) || limit < 1) {
    throw requestError(400, 'INVALID_LIMIT', 'The page size must be a positive integer.')
  }
  return Math.min(limit, MAX_PAGE_SIZE)
}

function relativeTime(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  return `${Math.floor(seconds / 86400)} days ago`
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase()
}

function serializePerson(user) {
  const profile = user.profile
  return {
    id: user.id,
    name: profile?.name ?? user.username,
    username: user.username,
    handle: `@${user.username}`,
    profilePicture: profile?.profilePicture ?? null,
    bio: profile?.bio ?? '',
    initials: initials(user.username),
    isPrivate: user.settings?.isPrivate === true,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
  }
}

function serializePost(post, viewerId) {
  const author = serializePerson(post.user)
  const media = post.media[0] ?? null
  return {
    id: post.id,
    type: post.format === 'Reel' ? 'reel' : media?.mediaType ?? 'text',
    format: post.format ?? 'Post',
    media: media?.url ?? '',
    mediaItems: post.media.map((item) => ({
      id: item.id,
      url: item.url,
      type: item.mediaType,
      contentType: item.contentType,
    })),
    author: author.name,
    handle: author.username,
    profileId: author.id,
    username: author.username,
    profilePicture: author.profilePicture,
    isPrivate: author.isPrivate,
    initials: author.initials,
    tone: 'amber',
    context: 'A post from your world',
    time: relativeTime(post.createdAt),
    title: post.caption || post.content || '',
    body: post.caption ? post.content || '' : '',
    replies: post._count.comments,
    resonated: post._count.likes - Number(post.likes.length > 0),
    comments: [],
    liked: post.likes.length > 0,
    saved: post.savedBy.length > 0,
    own: post.userId === viewerId,
  }
}

function serializeStory(story) {
  const person = serializePerson(story.user)
  const own = story.userId === story._viewerId
  return {
    id: story.id,
    profileId: person.id,
    userId: person.id,
    name: person.name,
    initials: person.initials,
    profilePicture: person.profilePicture,
    username: person.username,
    tone: 'amber',
    type: story.mediaType,
    media: story.mediaUrl,
    caption: story.caption || '',
    createdAt: story.createdAt.toISOString(),
    expiresAt: story.expiresAt.toISOString(),
    own,
    viewed: story.views.some((view) => view.userId === story._viewerId),
    liked: story.likes?.some((like) => like.userId === story._viewerId) ?? false,
    viewCount: story._count?.views ?? story.views.length,
    likeCount: story._count?.likes ?? story.likes?.length ?? 0,
  }
}

function validateMedia(input, userId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw requestError(400, 'INVALID_MEDIA', 'Provide a valid uploaded media item.')
  }
  const { url, assetId, mediaType, contentType, bytes } = input
  if (typeof assetId !== 'string' || !assetId.startsWith(mediaOwnershipPrefix(userId))) {
    throw requestError(400, 'INVALID_MEDIA', 'The media item is invalid or does not belong to your account.')
  }
  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw requestError(400, 'INVALID_MEDIA', 'The media item is invalid or does not belong to your account.')
  }
  const allowedContentTypes = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
  ])
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'res.cloudinary.com' || !parsedUrl.pathname.includes(assetId)
    || !MEDIA_TYPES.has(mediaType)
    || !allowedContentTypes.has(contentType)
    || ((contentType.startsWith('video/') ? 'video' : 'image') !== mediaType)
    || (bytes != null && (!Number.isSafeInteger(bytes) || bytes < 0))) {
    throw requestError(400, 'INVALID_MEDIA', 'The media item is invalid or does not belong to your account.')
  }
  return { url, assetId, mediaType, contentType, sizeBytes: bytes ?? null }
}

function validateHighlightTitle(value) {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title || title.length > MAX_HIGHLIGHT_TITLE_LENGTH) {
    throw requestError(400, 'INVALID_HIGHLIGHT_TITLE', `Highlight titles must contain 1 to ${MAX_HIGHLIGHT_TITLE_LENGTH} characters.`)
  }
  return title
}

function validateHighlightStoryIds(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || value.length > MAX_HIGHLIGHT_STORIES
    || (!allowEmpty && value.length === 0)
    || value.some((id) => typeof id !== 'string' || !id.trim())
    || new Set(value).size !== value.length) {
    throw requestError(400, 'INVALID_HIGHLIGHT_STORIES', 'Choose between 1 and 100 unique stories for this highlight.')
  }
  return value
}

function serializeHighlight(highlight, includeStories = false) {
  const items = includeStories
    ? highlight.items.filter(({ story }) => story.userId === highlight.ownerId)
    : highlight.items
  return {
    id: highlight.id,
    title: highlight.title,
    coverUrl: highlight.coverUrl,
    coverType: highlight.coverType,
    displayOrder: highlight.displayOrder,
    createdAt: highlight.createdAt.toISOString(),
    updatedAt: highlight.updatedAt.toISOString(),
    itemCount: items.length,
    ...(includeStories ? {
      items: items.map(({ story }) => ({
        id: story.id,
        media: story.mediaUrl,
        type: story.mediaType,
        caption: story.caption || '',
        createdAt: story.createdAt.toISOString(),
      })),
    } : {}),
  }
}

function highlightItemsInclude(ownerId) {
  return {
    items: {
      where: { story: { userId: ownerId } },
      include: { story: true },
      orderBy: { position: 'asc' },
    },
  }
}

async function canViewUserContent(viewerId, authorId, isPrivate) {
  if (!isPrivate || viewerId === authorId) return true
  const follow = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: viewerId, followingId: authorId } },
    select: { status: true },
  })
  return follow?.status === 'accepted'
}

async function findVisiblePost(postId, viewerId) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { user: { include: { settings: true } } },
  })
  if (!post) return null
  if (!(await canViewUserContent(viewerId, post.userId, post.user.settings?.isPrivate === true))) return null
  return post
}

router.use(requireAuth)

router.get('/posts/saved', async (request, response, next) => {
  try {
    const follows = await prisma.follow.findMany({
      where: { followerId: request.auth.userId, status: 'accepted' },
      select: { followingId: true },
    })
    const followedUserIds = new Set(follows.map((follow) => follow.followingId))
    const savedPosts = await prisma.savedPost.findMany({
      where: { userId: request.auth.userId },
      include: {
        post: {
          include: {
            user: { include: { profile: true, settings: true } },
            media: { orderBy: { position: 'asc' } },
            _count: { select: { likes: true, comments: true } },
            likes: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
            savedBy: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const visiblePosts = savedPosts
      .filter(({ post }) => (
        post.user.settings?.isPrivate !== true
        || post.userId === request.auth.userId
        || followedUserIds.has(post.userId)
      ))
      .map(({ post }) => serializePost(post, request.auth.userId))
    response.status(200).json({ data: { posts: visiblePosts.filter(Boolean) } })
  } catch (error) {
    next(error)
  }
})

router.get('/settings/privacy', async (request, response, next) => {
  try {
    const settings = await prisma.userSettings.findUnique({
      where: { userId: request.auth.userId },
      select: { isPrivate: true, allowNicknamesFrom: true },
    })
    response.status(200).json({ data: { privacy: { isPrivate: settings?.isPrivate ?? false, allowNicknamesFrom: settings?.allowNicknamesFrom ?? 'everyone' } } })
  } catch (error) {
    next(error)
  }
})

router.put('/settings/privacy', async (request, response, next) => {
  try {
    const isPrivate = request.body?.privacy?.isPrivate
    const allowNicknamesFrom = request.body?.privacy?.allowNicknamesFrom
    if ((isPrivate !== undefined && typeof isPrivate !== 'boolean')
      || (allowNicknamesFrom !== undefined && !['everyone', 'following', 'nobody'].includes(allowNicknamesFrom))
      || (isPrivate === undefined && allowNicknamesFrom === undefined)) {
      response.status(400).json({ error: { code: 'INVALID_PRIVACY_SETTINGS', message: 'Choose valid profile visibility and nickname permissions.' } })
      return
    }
    const settings = await prisma.userSettings.upsert({
      where: { userId: request.auth.userId },
      create: { userId: request.auth.userId, isPrivate: isPrivate ?? false, ...(allowNicknamesFrom ? { allowNicknamesFrom } : {}) },
      update: { ...(isPrivate !== undefined ? { isPrivate } : {}), ...(allowNicknamesFrom ? { allowNicknamesFrom } : {}) },
      select: { isPrivate: true, allowNicknamesFrom: true },
    })
    response.status(200).json({ data: { privacy: { isPrivate: settings.isPrivate, allowNicknamesFrom: settings.allowNicknamesFrom } } })
  } catch (error) {
    next(error)
  }
})

router.get('/users/search', async (request, response, next) => {
  try {
    const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 50) : ''
    if (query.length === 1) {
      response.status(200).json({ data: { users: [] } })
      return
    }
    const users = await prisma.user.findMany({
      where: {
        id: { not: request.auth.userId },
        ...(query ? {
          OR: [
            { username: { contains: query, mode: 'insensitive' } },
            { profile: { is: { name: { contains: query, mode: 'insensitive' } } } },
          ],
        } : {}),
      },
      select: {
        id: true,
        username: true,
        lastSeenAt: true,
        profile: { select: { name: true, bio: true, profilePicture: true } },
        settings: { select: { isPrivate: true } },
        followsReceived: {
          where: { followerId: request.auth.userId },
          select: { status: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    response.status(200).json({
      data: {
        users: users.map((user) => ({
          ...serializePerson(user),
          following: user.followsReceived[0]?.status === 'accepted',
          requested: user.followsReceived[0]?.status === 'requested',
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/posts/discover', async (request, response, next) => {
  try {
    const follows = await prisma.follow.findMany({
      where: { followerId: request.auth.userId, status: 'accepted' },
      select: { followingId: true },
    })
    const excludedIds = [request.auth.userId, ...follows.map((follow) => follow.followingId)]
    const posts = await prisma.post.findMany({
      where: {
        userId: { notIn: excludedIds },
        OR: [
          { user: { settings: { is: { isPrivate: false } } } },
          { user: { settings: { is: null } } },
        ],
      },
      include: {
        user: { include: { profile: true, settings: true } },
        media: { orderBy: { position: 'asc' } },
        _count: { select: { likes: true, comments: true } },
        likes: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
        savedBy: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
    })
    response.status(200).json({ data: { posts: posts.map((post) => serializePost(post, request.auth.userId)) } })
  } catch (error) {
    next(error)
  }
})

router.patch('/profiles/me', async (request, response, next) => {
  try {
    const body = request.body ?? {}
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const username = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '').toLowerCase() : ''
    const bio = typeof body.bio === 'string' ? body.bio.trim() : ''
    let profilePictureUrl
    if (!name || name.length > 120 || !/^[a-z0-9._]{3,30}$/.test(username) || bio.length > 500) {
      response.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Provide a name (up to 120 characters), username (3–30 letters, numbers, periods, or underscores), and bio (up to 500 characters).' },
      })
      return
    }
    if (Object.hasOwn(body, 'profilePicture')) {
      const photo = body.profilePicture
      if (photo !== null) {
        let photoUrl
        try {
          photoUrl = new URL(photo?.url)
        } catch {
          response.status(400).json({ error: { code: 'INVALID_PROFILE_PHOTO', message: 'Choose a valid uploaded profile photo.' } })
          return
        }
        const allowedPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
        if (typeof photo.assetId !== 'string'
          || !photo.assetId.startsWith(mediaOwnershipPrefix(request.auth.userId))
          || photo.mediaType !== 'image'
          || !allowedPhotoTypes.has(photo.contentType)
          || photoUrl.protocol !== 'https:'
          || photoUrl.hostname !== 'res.cloudinary.com'
          || !photoUrl.pathname.includes(photo.assetId)) {
          response.status(400).json({ error: { code: 'INVALID_PROFILE_PHOTO', message: 'Choose a valid uploaded profile photo.' } })
          return
        }
        profilePictureUrl = photo.url
      } else {
        profilePictureUrl = null
      }
    }
    const user = await prisma.user.update({
      where: { id: request.auth.userId },
      data: {
        username,
        profile: {
          update: {
            name,
            bio,
            ...(Object.hasOwn(body, 'profilePicture') ? { profilePicture: profilePictureUrl } : {}),
          },
        },
      },
      include: { profile: true, settings: true },
    })
    response.status(200).json({ data: { profile: serializePerson(user) } })
  } catch (error) {
    if (error.code === 'P2002') {
      response.status(409).json({ error: { code: 'USERNAME_UNAVAILABLE', message: 'That username is already taken.' } })
      return
    }
    next(error)
  }
})

router.post('/users/:userId/report', reportLimiter, async (request, response, next) => {
  try {
    const targetUserId = request.params.userId
    const reason = request.body?.reason
    const details = typeof request.body?.details === 'string' ? request.body.details.trim() : ''
    if (targetUserId === request.auth.userId) {
      response.status(400).json({ error: { code: 'CANNOT_REPORT_SELF', message: 'You cannot report your own account.' } })
      return
    }
    if (typeof reason !== 'string' || !REPORT_REASONS.has(reason) || details.length > 1000) {
      response.status(400).json({ error: { code: 'INVALID_REPORT', message: 'Choose a report reason and keep details under 1,000 characters.' } })
      return
    }
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
    if (!target) {
      response.status(404).json({ error: { code: 'ACCOUNT_NOT_FOUND', message: 'This account could not be found.' } })
      return
    }
    const existing = await prisma.userReport.findFirst({
      where: { reporterUserId: request.auth.userId, reportedUserId: target.id, status: 'open' },
      select: { id: true },
    })
    if (existing) {
      response.status(409).json({ error: { code: 'REPORT_ALREADY_OPEN', message: 'You already have an open report for this account.' } })
      return
    }
    await prisma.userReport.create({
      data: {
        reporterUserId: request.auth.userId,
        reportedUserId: target.id,
        reason,
        details: details || null,
      },
    })
    response.status(201).json({ data: { submitted: true } })
  } catch (error) {
    next(error)
  }
})

router.get('/profiles/:username', async (request, response, next) => {
  try {
    const username = request.params.username.replace(/^@/, '').toLowerCase()
    const user = await prisma.user.findFirst({
      where: { OR: [{ username }, { id: request.params.username }] },
      include: {
        profile: true,
        settings: true,
        _count: { select: { posts: true } },
        followsReceived: {
          where: { followerId: request.auth.userId },
          select: { status: true },
          take: 1,
        },
      },
    })
    if (!user) {
      response.status(404).json({ error: { code: 'PROFILE_NOT_FOUND', message: 'This profile could not be found.' } })
      return
    }
    const [followerCount, followingCount] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id, status: 'accepted' } }),
      prisma.follow.count({ where: { followerId: user.id, status: 'accepted' } }),
    ])
    const canViewPosts = await canViewUserContent(request.auth.userId, user.id, user.settings?.isPrivate === true)
    const posts = canViewPosts ? await prisma.post.findMany({
      where: { userId: user.id },
      include: {
        user: { include: { profile: true, settings: true } },
        media: { orderBy: { position: 'asc' } },
        _count: { select: { likes: true, comments: true } },
        likes: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
        savedBy: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
    }) : []
    const highlights = canViewPosts ? await prisma.highlight.findMany({
      where: { ownerId: user.id },
      include: {
        items: {
          where: { story: { is: { userId: user.id } } },
          select: { storyId: true },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    }) : []
    response.status(200).json({
      data: {
        profile: {
          ...serializePerson(user),
          postCount: user._count.posts,
          followerCount,
          followingCount,
          following: user.followsReceived[0]?.status === 'accepted',
          requested: user.followsReceived[0]?.status === 'requested',
          posts: posts.map((post) => serializePost(post, request.auth.userId)),
          highlights: highlights.map((highlight) => serializeHighlight(highlight)),
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/profiles/:username/connections', async (request, response, next) => {
  try {
    const type = request.query.type
    if (!['followers', 'following'].includes(type)) {
      response.status(400).json({ error: { code: 'INVALID_CONNECTION_TYPE', message: 'Choose followers or following.' } })
      return
    }
    const username = request.params.username.replace(/^@/, '').toLowerCase()
    const account = await prisma.user.findFirst({
      where: { OR: [{ username }, { id: request.params.username }] },
      select: { id: true, settings: { select: { isPrivate: true } } },
    })
    if (!account) {
      response.status(404).json({ error: { code: 'PROFILE_NOT_FOUND', message: 'This profile could not be found.' } })
      return
    }
    if (!(await canViewUserContent(request.auth.userId, account.id, account.settings?.isPrivate === true))) {
      response.status(403).json({ error: { code: 'PRIVATE_PROFILE', message: 'Follow this account to view its connections.' } })
      return
    }
    const connections = await prisma.follow.findMany({
      where: type === 'followers'
        ? { followingId: account.id, status: 'accepted' }
        : { followerId: account.id, status: 'accepted' },
      include: {
        follower: { include: { profile: true, settings: true } },
        following: { include: { profile: true, settings: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    response.status(200).json({
      data: {
        users: connections.map((item) => serializePerson(type === 'followers' ? item.follower : item.following)),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/posts/feed', async (request, response, next) => {
  try {
    const take = parseLimit(request.query.limit)
    const follows = await prisma.follow.findMany({
      where: { followerId: request.auth.userId, status: 'accepted' },
      select: { followingId: true },
    })
    const visibleUserIds = [request.auth.userId, ...follows.map((follow) => follow.followingId)]
    let cursor = null
    if (typeof request.query.cursor === 'string') {
      try {
        cursor = JSON.parse(Buffer.from(request.query.cursor, 'base64url').toString('utf8'))
        if (typeof cursor.id !== 'string' || Number.isNaN(Date.parse(cursor.createdAt))) throw new Error()
        cursor.createdAt = new Date(cursor.createdAt)
      } catch {
        response.status(400).json({ error: { code: 'INVALID_CURSOR', message: 'The feed cursor is invalid.' } })
        return
      }
    }
    const posts = await prisma.post.findMany({
      where: {
        OR: [
          { userId: { in: visibleUserIds } },
          { user: { settings: { is: { isPrivate: false } } } },
          { user: { settings: { is: null } } },
        ],
        ...(cursor ? {
          AND: [{
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }],
        } : {}),
      },
      include: {
        user: { include: { profile: true, settings: true } },
        media: { orderBy: { position: 'asc' } },
        _count: { select: { likes: true, comments: true } },
        likes: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
        savedBy: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    })
    const hasMore = posts.length > take
    const page = posts.slice(0, take)
    response.status(200).json({
      data: {
        posts: page.map((post) => serializePost(post, request.auth.userId)),
        nextCursor: hasMore
          ? Buffer.from(JSON.stringify({
            createdAt: page[page.length - 1].createdAt.toISOString(),
            id: page[page.length - 1].id,
          })).toString('base64url')
          : null,
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/posts', async (request, response, next) => {
  try {
    const body = request.body ?? {}
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    const caption = typeof body.caption === 'string' ? body.caption.trim() : ''
    const format = body.format ?? 'Post'
    if (!['Post', 'Reel'].includes(format)) {
      response.status(400).json({ error: { code: 'INVALID_POST_FORMAT', message: 'Choose Post or Reel as the post format.' } })
      return
    }
    if (content.length > 5000 || caption.length > 5000 || (!content && !caption && (!Array.isArray(body.media) || body.media.length === 0))) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Add text or at least one media item. Captions may contain up to 5,000 characters.' } })
      return
    }
    const media = body.media ?? []
    if (!Array.isArray(media) || media.length > 10) {
      response.status(400).json({ error: { code: 'INVALID_MEDIA', message: 'A post can include up to 10 media items.' } })
      return
    }
    const validMedia = media.map((item) => validateMedia(item, request.auth.userId))
    if (format === 'Reel' && !validMedia.some((item) => item.mediaType === 'video')) {
      response.status(400).json({ error: { code: 'REEL_VIDEO_REQUIRED', message: 'Choose a video to share a reel.' } })
      return
    }
    const post = await prisma.post.create({
      data: {
        userId: request.auth.userId,
        content: content || null,
        caption: caption || null,
        format,
        media: {
          create: validMedia.map((item, position) => ({
            url: item.url,
            storageKey: item.assetId,
            storageProvider: 'cloudinary',
            mediaType: item.mediaType,
            contentType: item.contentType,
            sizeBytes: item.sizeBytes == null ? null : BigInt(item.sizeBytes),
            position,
          })),
        },
      },
      include: {
        user: { include: { profile: true, settings: true } },
        media: { orderBy: { position: 'asc' } },
        _count: { select: { likes: true, comments: true } },
        likes: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
        savedBy: { where: { userId: request.auth.userId }, select: { id: true }, take: 1 },
      },
    })
    response.status(201).json({ data: { post: serializePost(post, request.auth.userId) } })
  } catch (error) {
    next(error)
  }
})

router.delete('/posts/:postId', async (request, response, next) => {
  try {
    const result = await prisma.post.deleteMany({
      where: { id: request.params.postId, userId: request.auth.userId },
    })
    if (!result.count) {
      response.status(404).json({ error: { code: 'POST_NOT_FOUND', message: 'This post could not be found.' } })
      return
    }
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.put('/posts/:postId/like', async (request, response, next) => {
  try {
    const post = await findVisiblePost(request.params.postId, request.auth.userId)
    if (!post) {
      response.status(404).json({ error: { code: 'POST_NOT_FOUND', message: 'This post could not be found.' } })
      return
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.like.upsert({
        where: { userId_postId: { userId: request.auth.userId, postId: post.id } },
        create: { userId: request.auth.userId, postId: post.id },
        update: {},
      })
      if (post.userId !== request.auth.userId) {
        await transaction.notification.upsert({
          where: { recipientId_actorId_type_postId: {
            recipientId: post.userId,
            actorId: request.auth.userId,
            type: 'LIKE',
            postId: post.id,
          } },
          create: {
            recipientId: post.userId,
            actorId: request.auth.userId,
            type: 'LIKE',
            postId: post.id,
          },
          update: { readAt: null, createdAt: new Date() },
        })
      }
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/posts/:postId/like', async (request, response, next) => {
  try {
    await prisma.like.deleteMany({
      where: { postId: request.params.postId, userId: request.auth.userId },
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.put('/posts/:postId/save', async (request, response, next) => {
  try {
    const post = await findVisiblePost(request.params.postId, request.auth.userId)
    if (!post) {
      response.status(404).json({ error: { code: 'POST_NOT_FOUND', message: 'This post could not be found.' } })
      return
    }
    await prisma.savedPost.upsert({
      where: { userId_postId: { userId: request.auth.userId, postId: post.id } },
      create: { userId: request.auth.userId, postId: post.id },
      update: {},
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/posts/:postId/save', async (request, response, next) => {
  try {
    await prisma.savedPost.deleteMany({
      where: { postId: request.params.postId, userId: request.auth.userId },
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.get('/posts/:postId/comments', async (request, response, next) => {
  try {
    const post = await findVisiblePost(request.params.postId, request.auth.userId)
    if (!post) {
      response.status(404).json({ error: { code: 'POST_NOT_FOUND', message: 'This post could not be found.' } })
      return
    }
    const comments = await prisma.comment.findMany({
      where: { postId: post.id, parentCommentId: null },
      include: { user: { include: { profile: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    response.status(200).json({
      data: {
        comments: comments.map((comment) => ({
          id: comment.id,
          name: comment.user.profile?.name ?? comment.user.username,
          userId: comment.userId,
          text: comment.content,
          createdAt: comment.createdAt.toISOString(),
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/posts/:postId/comments', async (request, response, next) => {
  try {
    const post = await findVisiblePost(request.params.postId, request.auth.userId)
    if (!post) {
      response.status(404).json({ error: { code: 'POST_NOT_FOUND', message: 'This post could not be found.' } })
      return
    }
    const content = typeof request.body?.content === 'string' ? request.body.content.trim() : ''
    if (!content || content.length > 2000) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Comments must contain between 1 and 2,000 characters.' } })
      return
    }
    const settings = await prisma.userSettings.findUnique({
      where: { userId: post.userId },
      select: { allowCommentsFrom: true },
    })
    if (settings?.allowCommentsFrom === 'nobody') {
      response.status(403).json({ error: { code: 'COMMENTS_DISABLED', message: 'This account is not accepting comments.' } })
      return
    }
    if (settings?.allowCommentsFrom === 'followers' && post.userId !== request.auth.userId) {
      const follow = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: request.auth.userId, followingId: post.userId } },
        select: { status: true },
      })
      if (follow?.status !== 'accepted') {
        response.status(403).json({ error: { code: 'COMMENTS_FOLLOWERS_ONLY', message: 'Only followers can comment on this post.' } })
        return
      }
    }
    const comment = await prisma.$transaction(async (transaction) => {
      const created = await transaction.comment.create({
        data: { postId: post.id, userId: request.auth.userId, content },
        include: { user: { include: { profile: true } } },
      })
      if (post.userId !== request.auth.userId) {
        await transaction.notification.create({
          data: {
            recipientId: post.userId,
            actorId: request.auth.userId,
            type: 'COMMENT',
            message: content.slice(0, 500),
            postId: post.id,
          },
        })
      }
      return created
    })
    response.status(201).json({
      data: {
        comment: {
          id: comment.id,
          name: comment.user.profile?.name ?? comment.user.username,
          userId: comment.userId,
          text: comment.content,
          createdAt: comment.createdAt.toISOString(),
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/highlights/stories', async (request, response, next) => {
  try {
    const stories = await prisma.story.findMany({
      where: { userId: request.auth.userId },
      select: {
        id: true,
        mediaUrl: true,
        mediaType: true,
        caption: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    response.status(200).json({
      data: {
        stories: stories.map((story) => ({
          id: story.id,
          media: story.mediaUrl,
          type: story.mediaType,
          caption: story.caption || '',
          createdAt: story.createdAt.toISOString(),
          expiresAt: story.expiresAt.toISOString(),
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.put('/highlights/order', async (request, response, next) => {
  try {
    const highlightIds = request.body?.highlightIds
    if (!Array.isArray(highlightIds) || highlightIds.length > MAX_HIGHLIGHT_COUNT
      || highlightIds.some((id) => typeof id !== 'string' || !id.trim())
      || new Set(highlightIds).size !== highlightIds.length) {
      throw requestError(400, 'INVALID_HIGHLIGHT_ORDER', 'Provide a unique ordered list of your highlights.')
    }
    const ownedHighlights = await prisma.highlight.findMany({
      where: { ownerId: request.auth.userId },
      select: { id: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    })
    const ownedIds = new Set(ownedHighlights.map(({ id }) => id))
    if (highlightIds.length !== ownedIds.size || highlightIds.some((id) => !ownedIds.has(id))) {
      throw requestError(400, 'INVALID_HIGHLIGHT_ORDER', 'The order must include all and only your highlights.')
    }
    await prisma.$transaction(highlightIds.map((id, displayOrder) => prisma.highlight.update({
      where: { id },
      data: { displayOrder },
    })))
    response.status(200).json({ data: { highlightIds } })
  } catch (error) {
    next(error)
  }
})

router.post('/highlights', async (request, response, next) => {
  try {
    const body = request.body ?? {}
    const title = validateHighlightTitle(body.title)
    const storyIds = validateHighlightStoryIds(body.storyIds)
    const [existingCount, stories] = await Promise.all([
      prisma.highlight.count({ where: { ownerId: request.auth.userId } }),
      prisma.story.findMany({
        where: { userId: request.auth.userId, id: { in: storyIds } },
        select: { id: true, mediaUrl: true, mediaType: true },
      }),
    ])
    if (existingCount >= MAX_HIGHLIGHT_COUNT) {
      throw requestError(400, 'HIGHLIGHT_LIMIT_REACHED', `You can create up to ${MAX_HIGHLIGHT_COUNT} highlights.`)
    }
    if (stories.length !== storyIds.length) {
      throw requestError(400, 'INVALID_HIGHLIGHT_STORIES', 'Highlights can only contain stories from your account.')
    }

    let coverUrl
    let coverType
    if (body.coverMedia != null) {
      if (body.coverStoryId != null) throw requestError(400, 'INVALID_HIGHLIGHT_COVER', 'Choose either an uploaded cover or a story cover.')
      const cover = validateMedia(body.coverMedia, request.auth.userId)
      if (cover.mediaType !== 'image') throw requestError(400, 'INVALID_HIGHLIGHT_COVER', 'A highlight cover must be an image.')
      coverUrl = cover.url
      coverType = 'image'
    } else {
      if (body.coverStoryId != null && !storyIds.includes(body.coverStoryId)) {
        throw requestError(400, 'INVALID_HIGHLIGHT_COVER', 'Choose a cover from a story in this highlight.')
      }
      const selectedCoverId = body.coverStoryId ?? stories.find(({ mediaType }) => mediaType === 'image')?.id
      const coverStory = stories.find(({ id }) => id === selectedCoverId)
      if (!coverStory || coverStory.mediaType !== 'image') {
        throw requestError(400, 'INVALID_HIGHLIGHT_COVER', 'Choose an image story or upload an image for the cover.')
      }
      coverUrl = coverStory.mediaUrl
      coverType = coverStory.mediaType
    }

    const highlight = await prisma.highlight.create({
      data: {
        ownerId: request.auth.userId,
        title,
        coverUrl,
        coverType,
        displayOrder: existingCount,
        items: { create: storyIds.map((storyId, position) => ({ storyId, position })) },
      },
      include: highlightItemsInclude(request.auth.userId),
    })
    response.status(201).json({ data: { highlight: serializeHighlight(highlight, true) } })
  } catch (error) {
    next(error)
  }
})

router.get('/highlights/:highlightId', async (request, response, next) => {
  try {
    const highlight = await prisma.highlight.findUnique({
      where: { id: request.params.highlightId },
      include: {
        owner: { include: { profile: true, settings: true } },
      items: { include: { story: true }, orderBy: { position: 'asc' } },
      },
    })
    if (!highlight
      || !(await canViewUserContent(request.auth.userId, highlight.ownerId, highlight.owner.settings?.isPrivate === true))) {
      response.status(404).json({ error: { code: 'HIGHLIGHT_NOT_FOUND', message: 'This highlight is unavailable.' } })
      return
    }
    response.status(200).json({
      data: {
        highlight: {
          ...serializeHighlight(highlight, true),
          owner: serializePerson(highlight.owner),
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

router.put('/highlights/:highlightId', async (request, response, next) => {
  try {
    const body = request.body ?? {}
    const title = validateHighlightTitle(body.title)
    const storyIds = validateHighlightStoryIds(body.storyIds, { allowEmpty: true })
    const existing = await prisma.highlight.findFirst({
      where: { id: request.params.highlightId, ownerId: request.auth.userId },
      select: { id: true, coverUrl: true, coverType: true },
    })
    if (!existing) {
      response.status(404).json({ error: { code: 'HIGHLIGHT_NOT_FOUND', message: 'This highlight is unavailable or you cannot edit it.' } })
      return
    }
    const stories = storyIds.length
      ? await prisma.story.findMany({
        where: { userId: request.auth.userId, id: { in: storyIds } },
        select: { id: true, mediaUrl: true, mediaType: true },
      })
      : []
    if (stories.length !== storyIds.length) {
      throw requestError(400, 'INVALID_HIGHLIGHT_STORIES', 'Highlights can only contain stories from your account.')
    }

    let coverUrl = existing.coverUrl
    let coverType = existing.coverType
    if (body.coverMedia != null) {
      if (body.coverStoryId != null) throw requestError(400, 'INVALID_HIGHLIGHT_COVER', 'Choose either an uploaded cover or a story cover.')
      const cover = validateMedia(body.coverMedia, request.auth.userId)
      if (cover.mediaType !== 'image') throw requestError(400, 'INVALID_HIGHLIGHT_COVER', 'A highlight cover must be an image.')
      coverUrl = cover.url
      coverType = 'image'
    } else if (body.coverStoryId != null) {
      if (!storyIds.includes(body.coverStoryId)) {
        throw requestError(400, 'INVALID_HIGHLIGHT_COVER', 'Choose a cover from a story in this highlight.')
      }
      const coverStory = stories.find(({ id }) => id === body.coverStoryId)
      if (!coverStory || coverStory.mediaType !== 'image') {
        throw requestError(400, 'INVALID_HIGHLIGHT_COVER', 'Choose an image story or upload an image for the cover.')
      }
      coverUrl = coverStory.mediaUrl
      coverType = coverStory.mediaType
    }

    const highlight = await prisma.highlight.update({
      where: { id: existing.id },
      data: {
        title,
        coverUrl,
        coverType,
        items: {
          deleteMany: {},
          create: storyIds.map((storyId, position) => ({ storyId, position })),
        },
      },
      include: highlightItemsInclude(request.auth.userId),
    })
    response.status(200).json({ data: { highlight: serializeHighlight(highlight, true) } })
  } catch (error) {
    next(error)
  }
})

router.delete('/highlights/:highlightId', async (request, response, next) => {
  try {
    const result = await prisma.highlight.deleteMany({
      where: { id: request.params.highlightId, ownerId: request.auth.userId },
    })
    if (!result.count) {
      response.status(404).json({ error: { code: 'HIGHLIGHT_NOT_FOUND', message: 'This highlight is unavailable or you cannot delete it.' } })
      return
    }
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.get('/stories', async (request, response, next) => {
  try {
    const follows = await prisma.follow.findMany({
      where: { followerId: request.auth.userId, status: 'accepted' },
      select: { followingId: true },
    })
    const visibleUserIds = [request.auth.userId, ...follows.map((follow) => follow.followingId)]
    const stories = await prisma.story.findMany({
      where: {
        expiresAt: { gt: new Date() },
        user: { mutedByStories: { none: { userId: request.auth.userId } } },
        OR: [
          { userId: { in: visibleUserIds } },
          { user: { settings: { is: { isPrivate: false } } } },
          { user: { settings: { is: null } } },
        ],
      },
      include: {
        user: { include: { profile: true, settings: true } },
        views: { where: { userId: request.auth.userId }, select: { userId: true } },
        likes: { where: { userId: request.auth.userId }, select: { userId: true } },
        _count: { select: { views: true, likes: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    response.status(200).json({ data: { stories: stories.map((story) => serializeStory({ ...story, _viewerId: request.auth.userId })) } })
  } catch (error) {
    next(error)
  }
})

router.post('/stories', async (request, response, next) => {
  try {
    const body = request.body ?? {}
    const media = validateMedia(body.media, request.auth.userId)
    const caption = typeof body.caption === 'string' ? body.caption.trim() : ''
    if (caption.length > 500) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Story captions may contain up to 500 characters.' } })
      return
    }
    const story = await prisma.story.create({
      data: {
        userId: request.auth.userId,
        mediaUrl: media.url,
        mediaType: media.mediaType,
        caption: caption || null,
        expiresAt: new Date(Date.now() + STORY_LIFETIME_MS),
      },
      include: {
        user: { include: { profile: true, settings: true } },
        views: { where: { userId: request.auth.userId }, select: { userId: true }, take: 1 },
        likes: { where: { userId: request.auth.userId }, select: { userId: true } },
        _count: { select: { views: true, likes: true } },
      },
    })
    response.status(201).json({ data: { story: serializeStory({ ...story, _viewerId: request.auth.userId }) } })
  } catch (error) {
    next(error)
  }
})

router.delete('/stories/:storyId', async (request, response, next) => {
  try {
    const result = await prisma.story.deleteMany({
      where: {
        id: request.params.storyId,
        userId: request.auth.userId,
        expiresAt: { gt: new Date() },
      },
    })
    if (result.count === 0) {
      response.status(404).json({ error: { code: 'STORY_NOT_FOUND', message: 'This story is unavailable or you cannot delete it.' } })
      return
    }
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.put('/stories/:storyId/mute', async (request, response, next) => {
  try {
    const story = await prisma.story.findFirst({
      where: { id: request.params.storyId, expiresAt: { gt: new Date() } },
      include: { user: { include: { settings: true } } },
    })
    if (!story || story.userId === request.auth.userId
      || !(await canViewUserContent(request.auth.userId, story.userId, story.user.settings?.isPrivate === true))) {
      response.status(404).json({ error: { code: 'STORY_NOT_FOUND', message: 'This story is unavailable.' } })
      return
    }
    await prisma.storyMute.upsert({
      where: { userId_mutedUserId: { userId: request.auth.userId, mutedUserId: story.userId } },
      create: { userId: request.auth.userId, mutedUserId: story.userId },
      update: {},
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.get('/stories/:storyId/insights', async (request, response, next) => {
  try {
    const story = await prisma.story.findFirst({
      where: {
        id: request.params.storyId,
        userId: request.auth.userId,
        expiresAt: { gt: new Date() },
      },
      include: {
        views: {
          where: { userId: { not: request.auth.userId } },
          include: { user: { include: { profile: true, settings: true } } },
          orderBy: { viewedAt: 'desc' },
        },
        likes: {
          include: { user: { include: { profile: true, settings: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!story) {
      response.status(404).json({ error: { code: 'STORY_NOT_FOUND', message: 'This story is unavailable.' } })
      return
    }
    response.status(200).json({
      data: {
        viewers: story.views.map((view) => serializePerson(view.user)),
        likers: story.likes.map((like) => serializePerson(like.user)),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/stories/:storyId/view', async (request, response, next) => {
  try {
    const story = await prisma.story.findFirst({
      where: { id: request.params.storyId, expiresAt: { gt: new Date() } },
      include: { user: { include: { settings: true } } },
    })
    if (!story || !(await canViewUserContent(request.auth.userId, story.userId, story.user.settings?.isPrivate === true))) {
      response.status(404).json({ error: { code: 'STORY_NOT_FOUND', message: 'This story is unavailable.' } })
      return
    }
    await prisma.storyView.upsert({
      where: { storyId_userId: { storyId: story.id, userId: request.auth.userId } },
      create: { storyId: story.id, userId: request.auth.userId },
      update: { viewedAt: new Date() },
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.put('/stories/:storyId/like', async (request, response, next) => {
  try {
    const story = await prisma.story.findFirst({
      where: { id: request.params.storyId, expiresAt: { gt: new Date() } },
      include: { user: { include: { settings: true } } },
    })
    if (!story || !(await canViewUserContent(request.auth.userId, story.userId, story.user.settings?.isPrivate === true))) {
      response.status(404).json({ error: { code: 'STORY_NOT_FOUND', message: 'This story is unavailable.' } })
      return
    }
    if (story.userId === request.auth.userId) {
      response.status(400).json({ error: { code: 'CANNOT_LIKE_OWN_STORY', message: 'You cannot like your own story.' } })
      return
    }
    await prisma.storyLike.upsert({
      where: { storyId_userId: { storyId: story.id, userId: request.auth.userId } },
      create: { storyId: story.id, userId: request.auth.userId },
      update: {},
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/stories/:storyId/like', async (request, response, next) => {
  try {
    const story = await prisma.story.findFirst({
      where: { id: request.params.storyId, expiresAt: { gt: new Date() } },
      include: { user: { include: { settings: true } } },
    })
    if (!story || !(await canViewUserContent(request.auth.userId, story.userId, story.user.settings?.isPrivate === true))) {
      response.status(404).json({ error: { code: 'STORY_NOT_FOUND', message: 'This story is unavailable.' } })
      return
    }
    const like = await prisma.storyLike.findUnique({
      where: { storyId_userId: { storyId: request.params.storyId, userId: request.auth.userId } },
    })
    if (like) await prisma.storyLike.delete({ where: { id: like.id } })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.put('/notes/me', async (request, response, next) => {
  try {
    const content = typeof request.body?.content === 'string' ? request.body.content.trim() : ''
    const audience = request.body?.audience
    if (!content || content.length > 60 || !AUDIENCES.has(audience)) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Provide note text (up to 60 characters) and a supported audience.' } })
      return
    }
    const expiresAt = new Date(Date.now() + STORY_LIFETIME_MS)
    const note = await prisma.note.upsert({
      where: { userId: request.auth.userId },
      create: { userId: request.auth.userId, content, audience, expiresAt },
      update: { content, audience, expiresAt },
      include: { user: { include: { profile: true, settings: true } } },
    })
    response.status(200).json({
      data: {
        note: {
          id: note.id,
          content: note.content,
          audience: note.audience,
          expiresAt: note.expiresAt.toISOString(),
          user: serializePerson(note.user),
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/notes', async (request, response, next) => {
  try {
    const follows = await prisma.follow.findMany({
      where: { followerId: request.auth.userId, status: 'accepted' },
      select: { followingId: true },
    })
    const followedUserIds = follows.map((follow) => follow.followingId)
    const closeFriendFollows = followedUserIds.length
      ? await prisma.follow.findMany({
        where: {
          followerId: { in: followedUserIds },
          followingId: request.auth.userId,
          status: 'accepted',
        },
        select: { followerId: true },
      })
      : []
    const notes = await prisma.note.findMany({
      where: {
        expiresAt: { gt: new Date() },
        OR: [
          { userId: request.auth.userId },
          { userId: { in: followedUserIds }, audience: 'followers' },
          { userId: { in: closeFriendFollows.map((follow) => follow.followerId) }, audience: 'close-friends' },
          { user: { settings: { is: { isPrivate: false } } }, audience: 'followers' },
        ],
      },
      include: { user: { include: { profile: true, settings: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    response.status(200).json({
      data: {
        notes: notes.map((note) => ({
          id: note.id,
          content: note.content,
          audience: note.audience,
          expiresAt: note.expiresAt.toISOString(),
          user: serializePerson(note.user),
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.delete('/notes/me', async (request, response, next) => {
  try {
    await prisma.note.deleteMany({ where: { userId: request.auth.userId } })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.post('/follows/:userId', async (request, response, next) => {
  try {
    const target = await prisma.user.findUnique({
      where: { id: request.params.userId },
      select: { id: true, settings: { select: { isPrivate: true } } },
    })
    if (!target || target.id === request.auth.userId) {
      response.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'This account cannot be followed.' } })
      return
    }
    const status = target.settings?.isPrivate ? 'requested' : 'accepted'
    const follow = await prisma.$transaction(async (transaction) => {
      const relation = await transaction.follow.upsert({
        where: { followerId_followingId: { followerId: request.auth.userId, followingId: target.id } },
        create: { followerId: request.auth.userId, followingId: target.id, status },
        update: { status },
        select: { status: true },
      })
      const notification = await transaction.notification.findFirst({
        where: {
          recipientId: target.id,
          actorId: request.auth.userId,
          type: 'FOLLOW',
          postId: null,
        },
        select: { id: true },
      })
      const notificationData = {
        recipientId: target.id,
        actorId: request.auth.userId,
        type: 'FOLLOW',
        message: relation.status === 'requested' ? 'requested to follow you' : 'started following you',
      }
      if (notification) {
        await transaction.notification.update({
          where: { id: notification.id },
          data: { ...notificationData, readAt: null, createdAt: new Date() },
        })
      } else {
        await transaction.notification.create({
          data: notificationData,
        })
      }
      return relation
    })
    response.status(200).json({ data: { status: follow.status } })
  } catch (error) {
    next(error)
  }
})

router.get('/follows/me', async (request, response, next) => {
  try {
    const [following, followers, requests] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: request.auth.userId, status: 'accepted' },
        select: { followingId: true },
      }),
      prisma.follow.findMany({
        where: { followingId: request.auth.userId, status: 'accepted' },
        select: { followerId: true },
      }),
      prisma.follow.findMany({
        where: { followerId: request.auth.userId, status: 'requested' },
        select: { followingId: true },
      }),
    ])
    response.status(200).json({
      data: {
        followingIds: following.map((item) => item.followingId),
        followerIds: followers.map((item) => item.followerId),
        requestIds: requests.map((item) => item.followingId),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.delete('/follows/:userId', async (request, response, next) => {
  try {
    await prisma.follow.deleteMany({
      where: { followerId: request.auth.userId, followingId: request.params.userId },
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.get('/follows/requests', async (request, response, next) => {
  try {
    const requests = await prisma.follow.findMany({
      where: { followingId: request.auth.userId, status: 'requested' },
      include: { follower: { include: { profile: true, settings: true } } },
      orderBy: { createdAt: 'desc' },
    })
    response.status(200).json({
      data: {
        requests: requests.map((item) => ({
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          user: serializePerson(item.follower),
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

router.post('/follows/requests/:followerId', async (request, response, next) => {
  try {
    const status = request.body?.status
    if (!['accepted', 'rejected'].includes(status)) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose accepted or rejected.' } })
      return
    }
    const result = await prisma.follow.updateMany({
      where: { followerId: request.params.followerId, followingId: request.auth.userId, status: 'requested' },
      data: { status: status === 'accepted' ? 'accepted' : 'rejected' },
    })
    if (!result.count) {
      response.status(404).json({ error: { code: 'FOLLOW_REQUEST_NOT_FOUND', message: 'This follow request is no longer available.' } })
      return
    }
    if (status === 'rejected') {
      await prisma.follow.deleteMany({
        where: { followerId: request.params.followerId, followingId: request.auth.userId, status: 'rejected' },
      })
    }
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
