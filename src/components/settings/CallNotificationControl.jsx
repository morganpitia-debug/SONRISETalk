import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { deletePushSubscription, getPushConfiguration, getPushSubscriptions, registerServiceWorker, savePushSubscription } from '../../api/push.js'

function applicationServerKeyToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(window.atob(padded), (character) => character.charCodeAt(0))
}

function pushConfigurationMessage(reason) {
  if (reason === 'missing') return 'Incoming-call alerts are unavailable because the server is missing its VAPID keys. Ask the administrator to configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.'
  if (reason === 'mismatch') return 'Incoming-call alerts are unavailable because the server VAPID keys do not match. Ask the administrator to configure one matching key pair.'
  if (reason === 'invalid_subject') return 'Incoming-call alerts are unavailable because the server VAPID contact address is invalid.'
  if (reason === 'invalid') return 'Incoming-call alerts are unavailable because the server VAPID key format is invalid.'
  return 'Incoming-call alerts are not configured on the server.'
}

function applicationServerKeyMatches(subscription, expectedKey) {
  const actualKey = subscription.options.applicationServerKey
  if (!actualKey) return false
  const actualBytes = new Uint8Array(actualKey)
  return actualBytes.length === expectedKey.length
    && actualBytes.every((byte, index) => byte === expectedKey[index])
}

function operationErrorMessage(error) {
  if (!navigator.onLine) return 'You appear to be offline. Reconnect and try enabling call alerts again.'
  if (error?.name === 'SecurityError') return 'Notifications require HTTPS or a trusted local development address.'
  return error?.message || 'Call notifications could not be enabled.'
}

export default function CallNotificationControl({ prompt = false, userId = '', onDismiss }) {
  const [supported, setSupported] = useState(false)
  const [statusChecked, setStatusChecked] = useState(false)
  const [supportMessage, setSupportMessage] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(false)
    setEnabled(false)
    setMessage('')
    setStatusChecked(false)
  }, [userId])

  useEffect(() => {
    let active = true
    async function readStatus() {
      const available = window.isSecureContext
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window
      if (!active) return
      setSupported(available)
      if (!available) {
        setSupportMessage(!window.isSecureContext
          ? 'Notifications require HTTPS or a trusted local development address.'
          : 'This browser does not support background push notifications.')
        setStatusChecked(true)
        return
      }
      setSupportMessage('')
      if (Notification.permission !== 'granted') {
        setStatusChecked(true)
        return
      }

      try {
        const [registration, stored, configuration] = await Promise.all([
          navigator.serviceWorker.getRegistration('/'),
          getPushSubscriptions(),
          getPushConfiguration(),
        ])
        const subscription = await registration?.pushManager.getSubscription()
        if (active) {
          setEnabled(Boolean(configuration.configured && subscription && stored.endpoints.includes(subscription.endpoint)))
          if (!configuration.configured) setMessage(pushConfigurationMessage(configuration.reason))
        }
      } catch (error) {
        if (active) setMessage(operationErrorMessage(error))
      } finally {
        if (active) setStatusChecked(true)
      }
    }
    void readStatus()
    return () => { active = false }
  }, [userId])

  async function enable() {
    setWorking(true)
    setMessage('')
    try {
      if (!window.isSecureContext) {
        throw new Error('Notifications require HTTPS or a trusted local development address.')
      }
      if (Notification.permission === 'denied') {
        throw new Error('Notifications are blocked. Allow them for Sonrisetalk in your browser or device settings, then try again.')
      }
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error(permission === 'denied'
          ? 'Notifications are blocked. Allow them for Sonrisetalk in your browser or device settings, then try again.'
          : 'Notification permission was not granted. Tap Enable alerts to try again.')
      }
      const configuration = await getPushConfiguration()
      if (!configuration.configured || !configuration.publicKey) {
        throw new Error(pushConfigurationMessage(configuration.reason))
      }
      const registration = await registerServiceWorker()
      const applicationServerKey = applicationServerKeyToBytes(configuration.publicKey)
      let subscription = await registration.pushManager.getSubscription()
      if (subscription && !applicationServerKeyMatches(subscription, applicationServerKey)) {
        await deletePushSubscription(subscription.endpoint)
        await subscription.unsubscribe()
        subscription = null
      }
      subscription ||= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        })
      const saved = await savePushSubscription(subscription.toJSON())
      if (!saved?.saved) throw new Error('The browser subscribed, but the server did not confirm this device registration.')
      setEnabled(true)
      setMessage('Call notifications are enabled on this device.')
    } catch (error) {
      setMessage(operationErrorMessage(error))
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
      setMessage(operationErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  function dismissPrompt() {
    setDismissed(true)
    onDismiss?.()
  }

  if (prompt) {
    if (!statusChecked || enabled || dismissed) return null
    const permissionDenied = supported && Notification.permission === 'denied'
    return (
      <div className="call-notification-prompt">
        <section className="call-notification-prompt__dialog" role="dialog" aria-modal="true" aria-labelledby="call-notification-title">
          <div className="call-notification-prompt__icon"><Icon name="notifications" size={25} /></div>
          <span className="call-notification-prompt__eyebrow">STAY CLOSE</span>
          <h2 id="call-notification-title">Be there when they call</h2>
          <p className="call-notification-prompt__description">
            Get an alert when someone invites you to an audio or group conversation, even when Sonrisetalk isn’t open in front of you.
          </p>
          <ul>
            <li><Icon name="phone" size={16} /><span>See incoming call invitations sooner</span></li>
            <li><Icon name="messages" size={16} /><span>Know when friends are gathering</span></li>
            <li><Icon name="notifications" size={16} /><span>Change or turn off alerts anytime in Settings</span></li>
          </ul>
          {!supported && <p className="call-notification-prompt__notice">{supportMessage}</p>}
          {permissionDenied && (
            <p className="call-notification-prompt__notice">
              Alerts are blocked by your browser. Open this site’s permissions in your browser or device settings, allow notifications, then reopen Sonrisetalk to enable them.
            </p>
          )}
          {message && <p className="call-notification-prompt__notice" role="alert">{message}</p>}
          {supported && !permissionDenied && (
            <p className="call-notification-prompt__hint">
              {Notification.permission === 'granted'
                ? 'You can turn off alerts anytime in Settings.'
                : 'Your browser will ask for permission after you choose Enable. On iPhone, add Sonrisetalk to your Home Screen first.'}
            </p>
          )}
          <div className="call-notification-prompt__actions">
            {supported && !permissionDenied && (
              <button type="button" disabled={working} onClick={enable}>
                {working ? 'Enabling…' : 'Enable call alerts'}
              </button>
            )}
            <button type="button" className="call-notification-prompt__later" disabled={working} onClick={dismissPrompt}>
              {supported && !permissionDenied ? 'Not now' : 'Continue without alerts'}
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="settings-push-control">
      <div className="settings-option-row">
        <span><strong>Incoming-call alerts</strong><small>{supportMessage || (supported ? enabled ? 'This device can show alerts when Sonrisetalk is closed.' : 'Allow this browser to alert you about incoming calls.' : 'Checking notification support…')}</small></span>
        <button className="settings-link-button" type="button" disabled={!supported || working} onClick={enabled ? disable : enable}>
          {working ? 'Please wait…' : enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      {message && <p className="settings-inline-notice" role="status">{message}</p>}
      {supported && Notification.permission === 'denied' && <p className="settings-section-intro">Notifications are blocked by the browser. Change this site's notification permission in your browser settings, then try again.</p>}
    </div>
  )
}
