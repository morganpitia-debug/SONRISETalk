import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import UserAvatar from '../UserAvatar.jsx'

function formatDuration(startedAt, now) {
  if (!startedAt) return '00:00'
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function CallOverlay({
  call,
  localStream,
  remoteStream,
  muted,
  cameraEnabled,
  error,
  clearError,
  onAccept,
  onDecline,
  onEnd,
  onToggleMute,
  onToggleCamera,
}) {
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const [now, setNow] = useState(Date.now())
  const [mediaError, setMediaError] = useState('')

  useEffect(() => {
    if (!call?.acceptedAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [call?.acceptedAt])

  useEffect(() => {
    let active = true
    setMediaError('')
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream
      if (remoteStream) {
        remoteAudioRef.current.play().then(() => {
          if (active) setMediaError('')
        }).catch(() => {
          if (active) setMediaError('Remote audio could not start. Check your device volume and allow audio playback.')
        })
      }
    }
    return () => { active = false }
  }, [localStream, remoteStream, call?.mediaType])

  if (!call && !error) return null
  const incoming = call?.phase === 'incoming'
  const status = incoming
    ? 'Incoming call'
    : call?.phase === 'outgoing'
      ? 'Calling…'
      : call?.phase === 'reconnecting'
        ? 'Reconnecting…'
        : call?.phase === 'active'
          ? formatDuration(call.acceptedAt, now)
          : 'Connecting…'

  return (
    <div className="messages-call-overlay" role="dialog" aria-modal="true" aria-label={call ? `${call.mediaType} call` : 'Call status'}>
      <section className={`messages-call-card${call?.mediaType === 'video' ? ' is-video' : ''}`}>
        {call?.mediaType === 'video' && <>
          <video ref={remoteVideoRef} className="messages-call-remote-video" autoPlay muted playsInline aria-label="Remote video" />
          <video ref={localVideoRef} className="messages-call-local-video" autoPlay muted playsInline aria-label="Your video" />
        </>}
        {call && <audio ref={remoteAudioRef} autoPlay aria-label="Remote call audio" />}
        <div className="messages-call-info">
          {call && <><UserAvatar person={{ profilePicture: call.peerProfilePicture }} className="messages-call-avatar" /><h2>{call.peerName}</h2><p>{status}{call.mediaType ? ` · ${call.mediaType} call` : ''}</p></>}
          {(error || mediaError) && <p className="messages-call-error" role="alert">{error || mediaError}</p>}
        </div>
        <div className="messages-call-controls">
          {incoming && <button className="messages-call-control is-accept" type="button" onClick={onAccept} aria-label="Answer call"><Icon name="phone" size={19} /></button>}
          {incoming && <button className="messages-call-control is-decline" type="button" onClick={onDecline} aria-label="Decline call"><Icon name="phone" size={19} /></button>}
          {call && !incoming && <>
            <button className={`messages-call-control${muted ? ' is-toggled' : ''}`} type="button" onClick={onToggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted}><Icon name="microphone" size={18} /></button>
            {call.mediaType === 'video' && <button className={`messages-call-control${!cameraEnabled ? ' is-toggled' : ''}`} type="button" onClick={onToggleCamera} aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!cameraEnabled}><Icon name="video" size={18} /></button>}
            <button className="messages-call-control is-decline" type="button" onClick={() => onEnd('completed')} aria-label="End call"><Icon name="phone" size={19} /></button>
          </>}
          {!call && error && <button className="messages-call-control" type="button" onClick={clearError}>Dismiss</button>}
        </div>
      </section>
    </div>
  )
}
