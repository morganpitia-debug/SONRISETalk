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
        : <UserAvatar person={{ name: participant.name, profilePicture: participant.profilePicture }} className="messages-call-participant__avatar" />}
      {participant.audioTrack && !participant.isLocal && <audio ref={audioRef} autoPlay aria-label={`${participant.name} audio`} />}
      <span>{participant.isLocal ? 'You' : participant.name}</span>
    </article>
  )
}

function GroupCallInviteDialog({ candidates, participants, invitedPeople, onInvite, onClose }) {
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const unavailableIds = new Set([
    ...participants.map((participant) => participant.userId),
    ...invitedPeople.map((person) => person.userId),
  ])
  const availableSlots = Math.max(0, 16 - participants.length - invitedPeople.length)
  const availablePeople = candidates.filter((person) => (
    !unavailableIds.has(person.id)
    && `${person.name} ${person.username}`.toLowerCase().includes(query.trim().toLowerCase())
  ))

  async function submit(event) {
    event.preventDefault()
    if (!selectedIds.length) return
    setSubmitting(true)
    setError('')
    try {
      const invited = await onInvite(selectedIds)
      setNotice(`Invitation${invited.length === 1 ? '' : 's'} sent to ${invited.map((person) => person.name).join(', ')}.`)
      setSelectedIds([])
    } catch (inviteError) {
      setError(inviteError.message || 'The selected people could not be invited.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="messages-call-invite-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="messages-call-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="messages-call-invite-title" onSubmit={submit}>
        <div className="messages-call-invite-dialog__heading">
          <div><span className="messages-eyebrow">GROUP CALL</span><h2 id="messages-call-invite-title">Invite people</h2></div>
          <button type="button" aria-label="Close invite people" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <p>Invite a mutual follow to join this call. They can accept or decline.</p>
        <label className="messages-call-invite-search"><Icon name="search" size={16} /><span className="visually-hidden">Search contacts</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts" /></label>
        <div className="messages-call-invite-list" aria-label="Available contacts">
          {availablePeople.map((person) => {
            const selected = selectedIds.includes(person.id)
            return <button className={`messages-call-invite-person${selected ? ' is-selected' : ''}`} key={person.id} type="button" aria-pressed={selected} disabled={!selected && selectedIds.length >= availableSlots} onClick={() => setSelectedIds((ids) => selected ? ids.filter((id) => id !== person.id) : [...ids, person.id])}>
              <UserAvatar person={person} className="messages-call-invite-person__avatar" />
              <span><strong>{person.name}</strong><small>@{person.username}</small></span>
              <span aria-hidden="true">{selected ? '✓' : '+'}</span>
            </button>
          })}
          {!availablePeople.length && <p className="messages-call-invite-empty">{candidates.length ? 'No available contacts match your search.' : 'Mutual-follow contacts could not be loaded.'}</p>}
        </div>
        <p className="messages-call-invite-capacity">{selectedIds.length} selected · {availableSlots} spaces available</p>
        {notice && <p className="messages-call-invite-notice" role="status">{notice}</p>}
        {error && <p className="messages-call-invite-error" role="alert">{error}</p>}
        <div className="messages-call-invite-actions">
          <button type="button" onClick={onClose}>Done</button>
          <button type="submit" disabled={submitting || !selectedIds.length}>{submitting ? 'Sending…' : `Invite${selectedIds.length ? ` (${selectedIds.length})` : ''}`}</button>
        </div>
      </form>
    </div>
  )
}

export default function CallOverlay({
  call,
  localStream,
  remoteStream,
  screenStream,
  groupParticipants = [],
  inviteCandidates = [],
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
  onInvitePeople,
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
  const [inviteOpen, setInviteOpen] = useState(false)
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
    setInviteOpen(false)
  }, [call?.id])

  if (!call && !error) return null
  const incoming = call?.phase === 'incoming'
  const screenShareSupported = typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getDisplayMedia)
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
  const handRaised = [...activities].reverse().find((event) => (
    event.userId === currentUserId && event.activity?.type === 'hand'
  ))?.activity.raised ?? false

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
          {call && <><UserAvatar person={{ profilePicture: call.peerProfilePicture }} className="messages-call-avatar" /><h2>{call.peerName}</h2><p className="messages-call-status-pill">{incoming && call.callMode === 'group' ? call.isHost ? 'Your group call is active · ' : `Invitation from ${call.caller?.name || 'a group member'} · ` : ''}{status}{call.mediaType ? ` · ${call.mediaType}` : ''}{call.callMode === 'group' && ` · ${groupParticipants.length} connected`}</p>{call.phase === 'active' && <p className="messages-call-encrypted-note">🔒 End-to-end encrypted</p>}</>}
          {(error || mediaError) && <p className="messages-call-error" role="alert">{error || mediaError}</p>}
          {call.phase === 'active' && !screenShareSupported && <p className="messages-call-screen-share-note" role="status">Screen sharing is not supported by this browser. Try a browser that supports screen capture.</p>}
          {activityError && <p className="messages-call-error" role="alert">{activityError}</p>}
        </div>
        <div className="messages-call-controls" role="toolbar" aria-label="Call controls">
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
            <div className="messages-call-activities" role="group" aria-label="Call activities">
              <button className="messages-call-control" type="button" aria-label="Send reaction" title="Send reaction" aria-expanded={reactionPickerOpen} onClick={() => setReactionPickerOpen((open) => !open)}><Icon name="emoji" size={18} /></button>
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
              <button className="messages-call-control" type="button" aria-expanded={chatOpen} aria-label={unreadChatCount > 0 ? `In-call chat, ${unreadChatCount} unread` : 'In-call chat'} title="In-call chat" onClick={() => {
                setChatOpen((open) => {
                  if (!open) setUnreadChatCount(0)
                  return !open
                })
              }}><Icon name="messages" size={18} />{unreadChatCount > 0 && <span className="messages-call-control__badge">{unreadChatCount}</span>}</button>
              <button className={`messages-call-control${screenStream ? ' is-toggled' : ''}`} type="button" disabled={!screenStream && !screenShareSupported} aria-label={screenStream ? 'Stop sharing screen' : screenShareSupported ? 'Share screen' : 'Screen sharing is not supported in this browser'} title={screenStream ? 'Stop sharing screen' : screenShareSupported ? 'Share screen' : 'Screen sharing is not supported in this browser'} aria-pressed={Boolean(screenStream)} onClick={async () => {
                setActivityError('')
                try {
                  await onToggleScreenShare()
                } catch (shareError) {
                  setActivityError(shareError.message || 'Screen sharing could not be started.')
                }
              }}><Icon name="screen" size={18} /></button>
              <button className={`messages-call-control${handRaised ? ' is-toggled' : ''}`} type="button" aria-label={handRaised ? 'Lower hand' : 'Raise hand'} title={handRaised ? 'Lower hand' : 'Raise hand'} aria-pressed={handRaised} onClick={async () => {
                setActivityError('')
                try {
                  await onSendActivity({ type: 'hand', raised: !handRaised })
                } catch (sendError) {
                  setActivityError(sendError.message || 'The hand status could not be updated.')
                }
              }}><Icon name="hand" size={18} /></button>
              {call.callMode === 'group' && <button className="messages-call-control" type="button" aria-label="Invite people to this call" title="Invite people" onClick={() => setInviteOpen(true)}><Icon name="add" size={18} /></button>}
            </div>
          </>}
          {incoming && <button className="messages-call-control is-accept" type="button" onClick={onAccept} aria-label={call.callMode === 'group' ? 'Join group call' : 'Answer call'}><Icon name="phone" size={19} /><span>{call.callMode === 'group' ? 'Join' : 'Accept'}</span></button>}
          {incoming && <button className="messages-call-control is-decline" type="button" onClick={onDecline} aria-label={call.callMode === 'group' ? 'Dismiss group call' : 'Decline call'}><Icon name="phone" size={19} /><span>Decline</span></button>}
          {call && !incoming && <>
            <button className={`messages-call-control${muted ? ' is-toggled' : ''}`} type="button" onClick={onToggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted}><Icon name="microphone" size={18} /></button>
            {call.mediaType === 'video' && <button className={`messages-call-control${!cameraEnabled ? ' is-toggled' : ''}`} type="button" onClick={onToggleCamera} aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!cameraEnabled}><Icon name="video" size={18} /></button>}
            <button className="messages-call-control is-decline" type="button" onClick={() => onEnd('completed')} aria-label={call.callMode === 'group' && !call.initiator ? 'Leave group call' : call.callMode === 'group' ? 'End group call for everyone' : 'End call'}><Icon name="phone" size={19} /></button>
          </>}
          {!call && error && <button className="messages-call-control" type="button" onClick={clearError} aria-label="Dismiss call error" title="Dismiss"><Icon name="close" size={18} /></button>}
        </div>
        {inviteOpen && call?.callMode === 'group' && <GroupCallInviteDialog
          candidates={inviteCandidates}
          participants={groupParticipants}
          invitedPeople={call.invitedPeople ?? []}
          onInvite={onInvitePeople}
          onClose={() => setInviteOpen(false)}
        />}
      </section>
    </div>
  )
}
