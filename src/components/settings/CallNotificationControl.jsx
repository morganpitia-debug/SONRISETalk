import { useEffect, useState } from 'react'
import { deletePushSubscription, getPushConfiguration, getPushSubscriptions, registerServiceWorker, savePushSubscription } from '../../api/push.js'

function applicationServerKeyToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(window.atob(padded), (character) => character.charCodeAt(0))
}

export default function CallNotificationControl() {
  const [supported, setSupported] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    async function readStatus() {
      const available = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      if (!active) return
      setSupported(available)
      if (!available || Notification.permission !== 'granted') return

      try {
        const [registration, stored] = await Promise.all([
          navigator.serviceWorker.getRegistration('/'),
          getPushSubscriptions(),
        ])
        const subscription = await registration?.pushManager.getSubscription()
        if (active && subscription) setEnabled(stored.endpoints.includes(subscription.endpoint))
      } catch (error) {
        if (active) setMessage(error.message || 'Could not check call notification settings.')
      }
    }
    void readStatus()
    return () => { active = false }
  }, [])

  async function enable() {
    setWorking(true)
    setMessage('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error(permission === 'denied'
          ? 'Notifications are blocked for this site in your browser settings.'
          : 'Allow notifications to receive incoming-call alerts.')
      }
      const configuration = await getPushConfiguration()
      if (!configuration.configured || !configuration.publicKey) {
        throw new Error('Call notifications need VAPID keys in the Render Web Service environment before they can be enabled.')
      }
      await registerServiceWorker()
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKeyToBytes(configuration.publicKey),
        })
      await savePushSubscription(subscription.toJSON())
      setEnabled(true)
      setMessage('Call notifications are enabled on this device.')
    } catch (error) {
      setMessage(error.message || 'Call notifications could not be enabled.')
    } finally {
      setWorking(false)
    }
  }

  async function disable() {
    setWorking(true)
    setMessage('')
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await deletePushSubscription(subscription.endpoint)
        await subscription.unsubscribe()
      }
      setEnabled(false)
      setMessage('Call notifications are disabled on this device.')
    } catch (error) {
      setMessage(error.message || 'Call notifications could not be disabled.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="settings-push-control">
      <div className="settings-option-row">
        <span><strong>Incoming-call alerts</strong><small>{supported ? enabled ? 'This device can show alerts when SONRISETALK is closed.' : 'Allow this browser to alert you about incoming calls.' : 'This browser does not support background call notifications.'}</small></span>
        <button className="settings-link-button" type="button" disabled={!supported || working} onClick={enabled ? disable : enable}>
          {working ? 'Please wait…' : enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      {message && <p className="settings-inline-notice" role="status">{message}</p>}
      {supported && Notification.permission === 'denied' && <p className="settings-section-intro">Notifications are blocked by the browser. Change this site's notification permission in your browser settings, then try again.</p>}
    </div>
  )
}
