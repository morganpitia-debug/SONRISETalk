import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import UserAvatar from '../UserAvatar.jsx'

function formatDuration(startedAt, now) {
  if (!startedAt) return '00:00'
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function GroupParticipantTile({ participant }) {
  const videoRef = useRef(null)
  const audioRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current
    const audio = audioRef.current
    if (video && participant.videoTrack) {
      video.srcObject = new MediaStream([participant.videoTrack])
      video.play().catch((error) => console.warn('Group participant video could not autoplay.', error))
    }
    if (audio && participant.audioTrack && !participant.isLocal) {
      audio.srcObject = new MediaStream([participant.audioTrack])
      audio.play().catch((error) => console.warn('Group participant audio could not autoplay.', error))
    }
    return () => {
      if (video) video.srcObject = null
      if (audio) audio.srcObject = null
    }
  }, [participant.videoTrack, participant.audioTrack, participant.isLocal])

  return (
    <article className={`messages-call-participant${participant.isLocal ? ' is-local' : ''}`} aria-label={participant.isLocal ? 'You' : participant.name}>
      {participant.videoTrack
        ? <video ref={videoRef} autoPlay muted={participant.isLocal} playsInline aria-label={`${participant.isLocal ? 'Your' : `${participant.name}'s`} video`} />
        : <UserAvatar person={{ name: participant.name }} className="messages-call-participant__avatar" />}
      {participant.audioTrack && !participant.isLocal && <audio ref={audioRef} autoPlay aria-label={`${participant.name} audio`} />}
      <span>{participant.isLocal ? 'You' : participant.name}</span>
    </article>
  )
}

export default function CallOverlay({
  call,
  localStream,
  remoteStream,
  screenStream,
  groupParticipants = [],
  muted,
  cameraEnabled,
  error,
  clearError,
  onAccept,
  onDecline,
  onEnd,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  activities = [],
  onSendActivity,
}) {
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const [now, setNow] = useState(Date.now())
  const [mediaError, setMediaError] = useState('')
  const [activityError, setActivityError] = useState('')
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [visibleReaction, setVisibleReaction] = useState(null)
  const chatEndRef = useRef(null)
  const seenChatCountRef = useRef(0)

  useEffect(() => {
    if (!call?.acceptedAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [call?.acceptedAt])

  useEffect(() => {
    let active = true
    setMediaError('')
    if (localVideoRef.current) localVideoRef.current.srcObject = screenStream || localStream
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
  }, [localStream, remoteStream, screenStream, call?.mediaType])

  useEffect(() => {
    const newestReaction = [...activities].reverse().find((event) => (
      event.activity?.type === 'reaction'
      && Date.now() - new Date(event.createdAt).getTime() < 2200
    ))
    if (!newestReaction) return undefined
    setVisibleReaction(newestReaction)
    const timer = window.setTimeout(() => setVisibleReaction(null), 2200)
    return () => window.clearTimeout(timer)
  }, [activities])

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activities, chatOpen])

  useEffect(() => {
    const chatCount = activities.filter((event) => event.activity?.type === 'chat').length
    const newMessages = Math.max(0, chatCount - seenChatCountRef.current)
    if (!chatOpen && newMessages) setUnreadChatCount((count) => count + newMessages)
    seenChatCountRef.current = chatCount
  }, [activities, chatOpen])

  useEffect(() => {
    setChatOpen(false)
    setReactionPickerOpen(false)
    setChatDraft('')
    setUnreadChatCount(0)
    seenChatCountRef.current = 0
    setActivityError('')
  }, [call?.id])

  if (!call && !error) return null
  const incoming = call?.phase === 'incoming'
  const peerId = call ? (call.initiator ? call.recipientId : call.initiatorId) : null
  const currentUserId = call?.currentUserId || peerId
  const remoteScreenSharing = [...activities].reverse().find((event) => (
    event.userId === peerId && event.activity?.type === 'share'
  ))?.activity.sharing ?? false
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
      <section className={`messages-call-card${call?.mediaType === 'video' ? ' is-video' : ''}${call?.callMode === 'group' ? ' is-group' : ''}`}>
        {call && <>
          {call.callMode !== 'group' && <>
            <video ref={remoteVideoRef} className={`messages-call-remote-video${call.mediaType !== 'video' && !remoteScreenSharing ? ' is-hidden' : ''}`} autoPlay muted playsInline aria-label="Remote video" />
            <video ref={localVideoRef} className={`messages-call-local-video${call.mediaType !== 'video' && !screenStream ? ' is-hidden' : ''}`} autoPlay muted playsInline aria-label="Your video" />
          </>}
          {call.callMode === 'group' && <div className="messages-call-participants" aria-label="Group call participants">
            {groupParticipants.map((participant) => <GroupParticipantTile key={participant.userId} participant={participant} />)}
            {!groupParticipants.length && <p className="messages-call-participants__loading">Connecting participants…</p>}
          </div>}
        </>}
        {call && <audio ref={remoteAudioRef} autoPlay aria-label="Remote call audio" />}
        <div className="messages-call-info">
          {call && <><UserAvatar person={{ profilePicture: call.peerProfilePicture }} className="messages-call-avatar" /><h2>{call.peerName}</h2><p>{incoming && call.callMode === 'group' ? call.isHost ? 'Your group call is active · ' : `Invitation from ${call.caller?.name || 'a group member'} · ` : ''}{status}{call.mediaType ? ` · ${call.mediaType} call` : ''}</p></>}
          {(error || mediaError) && <p className="messages-call-error" role="alert">{error || mediaError}</p>}
          {activityError && <p className="messages-call-error" role="alert">{activityError}</p>}
        </div>
        {call && call.phase === 'active' && <>
          {visibleReaction && <div className="messages-call-reaction" aria-live="polite" key={visibleReaction.id}>
            <span>{visibleReaction.activity.emoji}</span>
            <small>{visibleReaction.userId === currentUserId ? 'You' : groupParticipants.find((participant) => participant.userId === visibleReaction.userId)?.name || call.peerName}</small>
          </div>}
          {(() => {
            const latestHands = new Map()
            activities.filter((event) => event.activity?.type === 'hand').forEach((event) => latestHands.set(event.userId, event))
            const raisedHands = [...latestHands.values()].filter((event) => event.activity.raised && event.userId !== currentUserId)
            return raisedHands.length ? <div className="messages-call-hand-status" role="status">{raisedHands.map((event) => {
              const name = groupParticipants.find((participant) => participant.userId === event.userId)?.name || call.peerName
              return <span key={event.id}>✋ {name}</span>
            })}</div> : null
          })()}
          {chatOpen && <section className="messages-call-chat" aria-label="In-call chat">
            <header><h3>In-call chat</h3><button type="button" onClick={() => setChatOpen(false)} aria-label="Close in-call chat">×</button></header>
            <div className="messages-call-chat__messages" aria-live="polite">
              {activities.filter((event) => event.activity?.type === 'chat').map((event) => (
                <article key={event.id}>
                  <strong>{event.userId === currentUserId ? 'You' : groupParticipants.find((participant) => participant.userId === event.userId)?.name || call.peerName}</strong>
                  <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                  <p>{event.activity.text}</p>
                </article>
              ))}
              <span ref={chatEndRef} />
            </div>
            <form onSubmit={async (event) => {
              event.preventDefault()
              const text = chatDraft.trim()
              if (!text || !onSendActivity) return
              setActivityError('')
              try {
                await onSendActivity({ type: 'chat', text })
                setChatDraft('')
              } catch (sendError) {
                setActivityError(sendError.message || 'The message could not be sent.')
              }
            }}>
              <input aria-label="In-call message" maxLength={500} value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="Write a message…" />
              <button type="submit" disabled={!chatDraft.trim()}>Send</button>
            </form>
          </section>}
          <div className="messages-call-activities" aria-label="Call activities">
            <button type="button" aria-expanded={reactionPickerOpen} onClick={() => setReactionPickerOpen((open) => !open)}>React</button>
            {reactionPickerOpen && <div className="messages-call-reaction-picker" aria-label="Choose a reaction">
              {['❤️', '😂', '👍', '👏', '🔥', '😮', '😢'].map((emoji) => <button key={emoji} type="button" aria-label={`Send ${emoji} reaction`} onClick={async () => {
                setActivityError('')
                try {
                  await onSendActivity({ type: 'reaction', emoji })
                  setReactionPickerOpen(false)
                } catch (sendError) {
                  setActivityError(sendError.message || 'The reaction could not be sent.')
                }
              }}>{emoji}</button>)}
            </div>}
            <button type="button" aria-expanded={chatOpen} onClick={() => {
              setChatOpen((open) => {
                if (!open) setUnreadChatCount(0)
                return !open
              })
            }}>Chat{unreadChatCount > 0 ? ` (${unreadChatCount})` : ''}</button>
            <button type="button" aria-pressed={Boolean(screenStream)} onClick={async () => {
              setActivityError('')
              try {
                await onToggleScreenShare()
              } catch (shareError) {
                setActivityError(shareError.message || 'Screen sharing could not be started.')
              }
            }}>{screenStream ? 'Stop sharing' : 'Share screen'}</button>
            <button type="button" aria-pressed={(() => {
              return [...activities].reverse().find((event) => event.userId === currentUserId && event.activity?.type === 'hand')?.activity.raised ?? false
            })()} onClick={async () => {
              const isRaised = [...activities].reverse().find((event) => event.userId === currentUserId && event.activity?.type === 'hand')?.activity.raised ?? false
              setActivityError('')
              try {
                await onSendActivity({ type: 'hand', raised: !isRaised })
              } catch (sendError) {
                setActivityError(sendError.message || 'The hand status could not be updated.')
              }
            }}>✋ {(() => {
              return [...activities].reverse().find((event) => event.userId === currentUserId && event.activity?.type === 'hand')?.activity.raised ? 'Lower hand' : 'Raise hand'
            })()}</button>
          </div>
        </>}
        <div className="messages-call-controls">
          {incoming && <button className="messages-call-control is-accept" type="button" onClick={onAccept} aria-label={call.callMode === 'group' ? 'Join group call' : 'Answer call'}><Icon name="phone" size={19} /></button>}
          {incoming && <button className="messages-call-control is-decline" type="button" onClick={onDecline} aria-label={call.callMode === 'group' ? 'Dismiss group call' : 'Decline call'}><Icon name="phone" size={19} /></button>}
          {call && !incoming && <>
            <button className={`messages-call-control${muted ? ' is-toggled' : ''}`} type="button" onClick={onToggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted}><Icon name="microphone" size={18} /></button>
            {call.mediaType === 'video' && <button className={`messages-call-control${!cameraEnabled ? ' is-toggled' : ''}`} type="button" onClick={onToggleCamera} aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!cameraEnabled}><Icon name="video" size={18} /></button>}
            <button className="messages-call-control is-decline" type="button" onClick={() => onEnd('completed')} aria-label={call.callMode === 'group' && !call.initiator ? 'Leave group call' : call.callMode === 'group' ? 'End group call for everyone' : 'End call'}><Icon name="phone" size={19} /></button>
          </>}
          {!call && error && <button className="messages-call-control" type="button" onClick={clearError}>Dismiss</button>}
        </div>
      </section>
    </div>
  )
}
