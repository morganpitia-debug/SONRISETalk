import webpush from 'web-push'
import { prisma } from '../db.js'
import { getPushConfiguration } from './pushConfig.js'

function configureWebPush(configuration) {
  webpush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey)
}

async function sendPushNotification(userId, payload, failureLabel) {
  const status = getPushConfiguration()
  if (!status.configured) return
  try {
    const configuration = {
      publicKey: status.publicKey,
      privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
      subject: process.env.VAPID_SUBJECT.trim(),
    }
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
    if (!subscriptions.length) return
    configureWebPush(configuration)
    const serializedPayload = JSON.stringify(payload)
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, serializedPayload, { TTL: 45 })
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } })
          return
        }
        console.error(`Could not send ${failureLabel}:`, error)
      }
    }))
  } catch (error) {
    console.error(`Could not send ${failureLabel}:`, error)
  }
}

export async function sendIncomingCallPush(userId, call) {
  const callId = call.id ?? call.callId
  const groupCall = call.callMode === 'group'
  try {
    const activeCall = await prisma.call.findFirst({
      where: groupCall
        ? {
          id: callId,
          status: 'connected',
          OR: [
            { invitations: { some: { userId, status: 'invited' } } },
            {
              invitations: { none: { userId } },
              conversation: { members: { some: { userId } } },
            },
          ],
        }
        : { id: callId, recipientId: userId, status: 'ringing' },
      select: { id: true },
    })
    if (!activeCall) return
    const callerName = typeof call.caller?.name === 'string'
      ? call.caller.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80).trim()
      : ''
    await sendPushNotification(userId, {
      type: 'incoming-call',
      title: `${callerName || 'Someone'} is calling`,
      body: `${groupCall ? 'Group ' : ''}incoming ${call.mediaType === 'video' ? 'video' : 'voice'} call`,
      tag: `incoming-call-${callId}`,
      data: { callId, url: `/?incomingCallId=${encodeURIComponent(callId)}` },
    }, 'an incoming-call push notification')
  } catch (error) {
    console.error('Could not send an incoming-call push notification:', error)
  }
}

export async function sendMessagePush(userId, message) {
  const conversationId = typeof message.conversationId === 'string' ? message.conversationId : ''
  if (!conversationId) return
  const senderName = typeof message.senderName === 'string'
    ? message.senderName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80).trim()
    : ''
  const content = typeof message.content === 'string'
    ? message.content.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120).trim()
    : ''
  await sendPushNotification(userId, {
    type: 'incoming-message',
    title: senderName || 'New message',
    body: content || (message.hasImage ? 'Sent you a photo' : message.hasVoiceNote ? 'Sent you a voice note' : 'Sent you a message'),
    tag: `incoming-message-${conversationId}`,
    data: { conversationId, url: `/?conversationId=${encodeURIComponent(conversationId)}` },
  }, 'a message push notification')
}
