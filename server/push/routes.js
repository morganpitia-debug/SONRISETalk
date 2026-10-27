import { Router } from 'express'
import { requireAuth } from '../auth/session.js'
import { prisma } from '../db.js'
import { getPushConfiguration } from './pushConfig.js'
import { isAllowedPushEndpoint } from './pushValidation.js'

const router = Router()

router.use(requireAuth)

router.get('/config', (_request, response) => {
  response.status(200).json({ data: getPushConfiguration() })
})

router.get('/subscriptions', async (request, response, next) => {
  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: request.auth.userId },
      select: { endpoint: true },
    })
    response.status(200).json({ data: { endpoints: subscriptions.map(({ endpoint }) => endpoint) } })
  } catch (error) {
    next(error)
  }
})

router.post('/subscriptions', async (request, response, next) => {
  try {
    const subscription = request.body?.subscription
    const endpoint = subscription?.endpoint
    const p256dh = subscription?.keys?.p256dh
    const auth = subscription?.keys?.auth
    if (!isAllowedPushEndpoint(endpoint)
      || typeof p256dh !== 'string'
      || p256dh.length < 20
      || p256dh.length > 256
      || typeof auth !== 'string'
      || auth.length < 10
      || auth.length > 128) {
      response.status(400).json({ error: { code: 'INVALID_PUSH_SUBSCRIPTION', message: 'This browser notification subscription is invalid.' } })
      return
    }

    if (!getPushConfiguration().configured) {
      response.status(503).json({ error: { code: 'PUSH_NOT_CONFIGURED', message: 'Call notifications are not configured on the server yet.' } })
      return
    }

    await prisma.pushSubscription.upsert({
      where: { userId_endpoint: { userId: request.auth.userId, endpoint } },
      create: { userId: request.auth.userId, endpoint, p256dh, auth },
      update: { p256dh, auth },
    })
    response.status(201).json({ data: { saved: true } })
  } catch (error) {
    next(error)
  }
})

router.delete('/subscriptions', async (request, response, next) => {
  try {
    const endpoint = request.body?.endpoint
    if (!isAllowedPushEndpoint(endpoint)) {
      response.status(400).json({ error: { code: 'INVALID_PUSH_SUBSCRIPTION', message: 'This browser notification subscription is invalid.' } })
      return
    }
    await prisma.pushSubscription.deleteMany({ where: { userId: request.auth.userId, endpoint } })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
