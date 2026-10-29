import webpush from 'web-push'
import { prisma } from '../db.js'
import { getPushConfiguration } from './pushConfig.js'

function configureWebPush(configuration) {
  webpush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey)
}

export async function sendIncomingCallPush(userId, call) {
  const status = getPushConfiguration()
  if (!status.configured) return
  const configuration = {
    publicKey: status.publicKey,
    privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
    subject: process.env.VAPID_SUBJECT.trim(),
  }

  try {
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
    if (!subscriptions.length) return
    configureWebPush(configuration)
    const payload = JSON.stringify({
      title: `${call.caller.name} is calling`,
      body: call.callMode === 'group'
        ? `Incoming group ${call.mediaType} call${call.groupName ? ` · ${call.groupName}` : ''}`
        : `Incoming ${call.mediaType} call`,
      tag: `incoming-call-${call.id}`,
      data: { callId: call.id, url: '/' },
    })

    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 45 })
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } })
          return
        }
        console.error('Could not send an incoming-call push notification:', error)
      }
    }))
  } catch (error) {
    console.error('Could not load incoming-call push subscriptions:', error)
  }
}
