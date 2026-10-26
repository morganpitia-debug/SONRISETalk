import { ipKeyGenerator, rateLimit } from 'express-rate-limit'

export function createRateLimiter({
  windowMs = 60 * 1000,
  limit = 30,
  keyPrefix = 'request',
  message = { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
} = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (request) => {
      const userId = request.auth?.userId ?? request.user?.id
      if (userId) return `${keyPrefix}:${userId}`
      return `${keyPrefix}:${ipKeyGenerator(request)}`
    },
    message,
  })
}
