import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import ProfilePhotoButton from '../ProfilePhotoButton.jsx'
import UserAvatar from '../UserAvatar.jsx'
import { getAvatarInitial } from '../../utils/avatar.js'
import { addGroupMembers as addGroupMembersApi, createConversation, createRealtimeSocket, getAddableGroupMembers, getConversations, getMessages, leaveGroup as leaveGroupApi, refreshVoiceNoteUrl, setConversationMuted, setConversationNickname, uploadVoiceNote } from '../../api/messaging.js'
import { deleteNote, getNotes, getPrivacySettings, getProfileConnections, reportUser, saveNote, updatePrivacySettings, uploadMedia } from '../../api/social.js'
import { isApiEnabled } from '../../api/auth.js'
import { CallManagerContext } from '../../hooks/useCallManager.js'

const MAX_VOICE_NOTE_BYTES = 20 * 1024 * 1024

function messageContextLabel(message) {
  if (!['story_reply', 'Replied to your story', 'You replied to their story'].includes(message.contextLabel)) return ''
  return message.from === 'me' ? 'You replied to their story' : 'Replied to your story'
}

function PersonAvatar({ person, className = '', onClick }) {
  const avatar = <UserAvatar person={person} className={`messages-avatar ${className}`.trim()} />
  if (onClick) {
    return <button className={`messages-profile-avatar ${className}`.trim()} type="button" aria-label={`View ${person.name}'s profile`} title={`View ${person.name}'s profile`} onClick={onClick}>{avatar}</button>
  }
  return avatar
}

function GroupCreateDialog({ username, localMode = false, onClose, onCreate }) {
  const [step, setStep] = useState('members')
  const [followers, setFollowers] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [groupName, setGroupName] = useState('')
  const [groupPicture, setGroupPicture] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
  const picturePreview = useMemo(() => groupPicture ? URL.createObjectURL(groupPicture) : '', [groupPicture])

  useEffect(() => () => {
    if (picturePreview) URL.revokeObjectURL(picturePreview)
  }, [picturePreview])

  useEffect(() => {
    if (localMode) {
      setFollowers([])
      setLoading(false)
      setError('Sign in to load your followers and create a group.')
      return undefined
    }
    let active = true
    Promise.all([
      getProfileConnections(username, 'followers'),
      getProfileConnections(username, 'following'),
    ])
      .then(([followerResult, followingResult]) => {
        if (!active) return
        const followingIds = new Set(followingResult.users.map((person) => person.id))
        setFollowers(followerResult.users.filter((person) => followingIds.has(person.id)))
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Your followers could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [localMode, username])

  const visibleFollowers = followers.filter((person) => (
    `${person.name} ${person.username}`.toLowerCase().includes(search.trim().toLowerCase())
  ))

  function togglePerson(userId) {
    setSelectedIds((current) => {
      if (current.includes(userId)) return current.filter((id) => id !== userId)
      if (current.length >= 9) {
        setError('Groups can include up to nine people.')
        return current
      }
      setError('')
      return [...current, userId]
    })
  }

  async function submit(event) {
    event.preventDefault()
    if (selectedIds.length < 2) {
      setError('Select at least two people who follow you back.')
      return
    }
    if (!groupName.trim()) {
      setError('Enter a name for your group.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      let uploadedPicture = null
      if (groupPicture && !localMode) {
        const uploaded = await uploadMedia(groupPicture)
        uploadedPicture = {
          url: uploaded.url,
          assetId: uploaded.assetId,
          mediaType: uploaded.resourceType,
        }
      } else if (groupPicture) {
        uploadedPicture = { url: URL.createObjectURL(groupPicture) }
      }
      await onCreate(selectedIds, groupName.trim(), uploadedPicture)
    } catch (requestError) {
      setError(requestError.message || 'The group could not be created.')
      setSubmitting(false)
    }
  }

  return createPortal(
    <div className="messages-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="messages-modal messages-group-dialog" role="dialog" aria-modal="true" aria-labelledby="messages-group-title">
        <div className="messages-modal__heading">
          <div><span className="messages-eyebrow">A SPACE FOR YOUR PEOPLE</span><h2 id="messages-group-title">Create a group</h2></div>
          <button className="messages-icon-button" type="button" aria-label="Close group creation" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <form onSubmit={submit}>
          {step === 'members' ? <>
            <p className="messages-group-dialog__hint">Choose people who follow you back. You can add more people later if you follow each other.</p>
            <label className="messages-group-search"><Icon name="search" size={16} /><span className="visually-hidden">Search followers</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search followers" /></label>
            <div className="messages-group-members" aria-label="People who follow you back">
              {loading && <p className="messages-search-empty" role="status">Loading mutual follows…</p>}
              {!loading && !error && visibleFollowers.map((person) => {
                const selected = selectedIds.includes(person.id)
                return (
                  <button className={`messages-group-person${selected ? ' is-selected' : ''}`} type="button" key={person.id} aria-pressed={selected} onClick={() => togglePerson(person.id)}>
                    <PersonAvatar person={person} />
                    <span><strong>{person.name}</strong><small>@{person.username}</small></span>
                    <span className="messages-group-person__check" aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>
                  </button>
                )
              })}
              {!loading && !error && !visibleFollowers.length && <p className="messages-search-empty">{followers.length ? 'No mutual follows match your search.' : 'You do not have any mutual follows yet.'}</p>}
              {error && <p className="messages-group-error" role="alert">{error}</p>}
            </div>
            <div className="messages-group-selection" aria-live="polite">{selectedIds.length} selected</div>
            <div className="messages-modal__actions">
              <button className="messages-secondary-button" type="button" onClick={onClose}>Cancel</button>
              <button className="messages-primary-button" type="button" disabled={loading || selectedIds.length < 2} onClick={() => { setError(''); setStep('details') }}>Continue</button>
            </div>
          </> : <>
            <p className="messages-group-dialog__hint">Choose a name, then add a group picture or skip it.</p>
            <div className="messages-group-details">
              <label className="messages-group-name"><span>Group name</span><input maxLength={80} value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Name your group" autoFocus /></label>
              <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setGroupPicture(event.target.files?.[0] || null)} />
              <div className="messages-group-picture">
                {picturePreview ? <img src={picturePreview} alt="Group image preview" /> : <span><Icon name="profile" size={19} /></span>}
                <div><strong>Group picture</strong><small>Optional</small></div>
                <button className="messages-secondary-button" type="button" disabled={submitting} onClick={() => fileInputRef.current?.click()}>{picturePreview ? 'Change' : 'Add picture'}</button>
                {picturePreview && <button className="messages-icon-button" type="button" aria-label="Remove group picture" onClick={() => { setGroupPicture(null); if (fileInputRef.current) fileInputRef.current.value = '' }}><Icon name="close" size={15} /></button>}
              </div>
            </div>
            {error && <p className="messages-group-error" role="alert">{error}</p>}
            <div className="messages-modal__actions">
              <button className="messages-secondary-button" type="button" disabled={submitting} onClick={() => { setError(''); setStep('members') }}>Back</button>
              {!picturePreview && <button className="messages-secondary-button messages-group-skip" type="submit" disabled={submitting || !groupName.trim()}>{submitting ? 'Creating…' : 'Skip picture'}</button>}
              <button className="messages-primary-button" type="submit" disabled={submitting || !groupName.trim()}>{submitting ? 'Creating…' : 'Create group'}</button>
            </div>
          </>}
        </form>
      </section>
    </div>,
    document.body,
  )
}

function NotesStrip({ ownNote, notes = [], currentUser, onAdd, onEdit, onView }) {
  return (
    <section className="messages-notes" aria-label="Notes">
      <div className="messages-notes__list">
        <div className="message-note message-note--own">
          <span className="message-note__avatar-wrap">
            <button className="messages-note-profile-action" type="button" aria-label={ownNote ? 'Edit your note' : 'Add to your note'} onClick={ownNote ? onEdit : onAdd}><PersonAvatar person={currentUser} /></button>
            <button className="message-note__add" type="button" aria-label={ownNote ? 'Edit your note' : 'Add to your note'} onClick={ownNote ? onEdit : onAdd}><Icon name={ownNote ? 'pen' : 'add'} size={12} /></button>
          </span>
          <span className="message-note__name">Your Note</span>
          <button className={`message-note__bubble${ownNote ? ' message-note__bubble--filled' : ''}`} type="button" onClick={ownNote ? onEdit : onAdd}>
            {ownNote?.text || '+ Add note'}
          </button>
        </div>
        {notes.map((note) => (
          <div className="message-note" key={note.id}>
            <span className="message-note__avatar-wrap">
              <button className="messages-note-profile-action" type="button" aria-label={`View ${note.name}'s note`} onClick={() => onView(note)}><PersonAvatar person={note} /></button>
              {note.online && <span className="message-note__online" />}
            </span>
            <span className="message-note__name">{note.name.split(' ')[0]}</span>
            <button className="message-note__bubble" type="button" onClick={() => onView(note)}>{note.text}</button>
          </div>
        ))}
      </div>
    </section>
  )
}

function NoteEditor({ initialNote, onClose, onSave, onRemove }) {
  const [text, setText] = useState(initialNote?.text || '')
  const [audience, setAudience] = useState(initialNote?.audience === 'close-friends' || initialNote?.audience === 'Close friends' ? 'Close friends' : 'Followers')

  function submit(event) {
    event.preventDefault()
    if (!text.trim()) return
    onSave({ text: text.trim(), audience })
  }

  return (
    <div className="messages-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="messages-modal messages-note-editor" role="dialog" aria-modal="true" aria-labelledby="note-editor-title">
        <div className="messages-modal__heading">
          <div>
            <span className="messages-eyebrow">A SMALL THOUGHT</span>
            <h2 id="note-editor-title">{initialNote ? 'Edit your note' : 'Add a note'}</h2>
          </div>
          <button className="messages-icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <label className="visually-hidden" htmlFor="messages-note-input">Share a thought...</label>
          <textarea id="messages-note-input" maxLength={60} rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder="Share a thought..." autoFocus />
          <div className="messages-note-editor__meta"><span>Visible for 24 hours</span><span>{text.length}/60</span></div>
          <fieldset className="messages-audience">
            <legend>Share with</legend>
            {['Followers', 'Close friends'].map((option) => (
              <label key={option}>
                <input type="radio" name="note-audience" value={option} checked={audience === option} onChange={() => setAudience(option)} />
                <span>{option}</span>
              </label>
            ))}
          </fieldset>
          <div className="messages-modal__actions">
            {initialNote && <button className="messages-text-button messages-text-button--remove" type="button" onClick={onRemove}>Remove note</button>}
            <button className="messages-secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="messages-primary-button" type="submit" disabled={!text.trim()}>Share</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function NoteViewer({ note, onClose, onReply }) {
  return (
    <div className="messages-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="messages-modal messages-note-viewer" role="dialog" aria-modal="true" aria-labelledby="note-viewer-title">
        <button className="messages-icon-button messages-note-viewer__close" type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        <PersonAvatar person={note} className="messages-note-viewer__avatar" />
        <div className="messages-note-viewer__identity">
          <h2 id="note-viewer-title">{note.name}</h2>
          <span>{note.handle}</span>
        </div>
        <p className="messages-note-viewer__text">{note.text}</p>
        <p className="messages-note-viewer__expiry">{note.timeRemaining} · Notes disappear after 24 hours.</p>
        {!note.own && <button className="messages-primary-button messages-note-viewer__reply" type="button" onClick={onReply}>Reply</button>}
      </section>
    </div>
  )
}

function ConversationList({ conversations, messages, selectedId, onSelect, onViewProfile, query }) {
  return (
    <div className="messages-conversation-list">
      {conversations.map((conversation) => {
        const conversationMessages = messages[conversation.id] || conversation.messages
        const latest = conversationMessages[conversationMessages.length - 1]
        return (
          <div
            className={`messages-conversation${selectedId === conversation.id ? ' is-selected' : ''}`}
            key={conversation.id}
            aria-current={selectedId === conversation.id ? 'true' : undefined}
          >
            <span className="messages-conversation__avatar-wrap">
              <PersonAvatar person={conversation} onClick={conversation.profileId ? () => onViewProfile(conversation.profileId) : undefined} />
              {conversation.online && <span className="messages-presence" />}
            </span>
            <button className="messages-conversation__select" type="button" onClick={() => onSelect(conversation.id)}>
              <span className="messages-conversation__copy">
              <span className="messages-conversation__top"><strong>{conversation.nickname || conversation.name}</strong><time>{conversation.time}</time></span>
              <span className="messages-conversation__bottom"><span>{latest ? `${messageContextLabel(latest) ? `${messageContextLabel(latest)} · ` : ''}${latest.text?.replace(/\n/g, ' ') || (latest.imageUrl ? 'Photo' : '')}` : 'Start a conversation'}</span>{conversation.muted && <Icon name="mute" size={12} className="messages-conversation__muted" aria-label="Messages muted" />}{conversation.unread > 0 && <i>{conversation.unread}</i>}</span>
              </span>
            </button>
          </div>
        )
      })}
      {conversations.length === 0 && <p className="messages-search-empty">{query.trim() ? 'No conversations match your search.' : 'No conversations yet.'}</p>}
    </div>
  )
}

function EmptyChat() {
  return (
    <div className="messages-empty-chat">
      <span className="messages-empty-chat__icon"><Icon name="messages" size={24} /></span>
      <h2>Your messages</h2>
      <p>Choose a conversation to start talking.</p>
    </div>
  )
}

function formatVoiceTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function VoiceNotePlayer({ src, outgoing = false, preview = false, onRefresh, onError }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [readyToPlay, setReadyToPlay] = useState(false)
  const [playbackSrc, setPlaybackSrc] = useState(preview ? src : '')
  const refreshedRef = useRef(false)
  const refreshingRef = useRef(false)
  const bars = [7, 13, 9, 18, 11, 22, 14, 8, 17, 24, 12, 19, 10, 15, 23, 11, 7, 17, 21, 13, 9, 19, 12, 23, 15, 8, 18, 11, 21, 14, 9, 17, 24, 12, 19, 8, 15, 22, 11, 18, 7, 14, 20, 10, 17, 23, 12, 8]
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setFailed(false)
    setRefreshing(false)
    setReadyToPlay(false)
    setPlaybackSrc(preview ? src : '')
    refreshedRef.current = false
    refreshingRef.current = false
    audioRef.current?.pause()
  }, [src])

  useEffect(() => () => {
    if (!preview && playbackSrc.startsWith('blob:')) URL.revokeObjectURL(playbackSrc)
  }, [playbackSrc, preview])

  async function refreshPlaybackUrl(error) {
    if (refreshingRef.current) return
    if (!onRefresh || refreshedRef.current) {
      setFailed(true)
      onError?.(error)
      return
    }
    refreshedRef.current = true
    refreshingRef.current = true
    setRefreshing(true)
    try {
      const freshUrl = await onRefresh()
      if (typeof freshUrl !== 'string' || !freshUrl) throw new Error('A fresh voice-note link was not returned.')
      if (audioRef.current) {
        audioRef.current.src = freshUrl
        audioRef.current.load()
      }
      setPlaybackSrc(freshUrl)
      setFailed(false)
      setCurrentTime(0)
      setDuration(0)
      setReadyToPlay(true)
      return freshUrl
    } catch (error) {
      setFailed(true)
      onError?.(error)
      return null
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio || failed || refreshing) return
    if (audio.paused) {
      try {
        if (!playbackSrc && onRefresh) {
          await refreshPlaybackUrl()
          return
        }
        await audio.play()
        setReadyToPlay(false)
      } catch {
        void refreshPlaybackUrl()
      }
    } else {
      audio.pause()
    }
  }

  function seek(event) {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    const nextTime = Number(event.target.value)
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  return (
    <div className={`messages-voice-player${outgoing ? ' is-outgoing' : ''}${preview ? ' is-preview' : ''}${failed ? ' is-error' : ''}`}>
      <audio
        ref={audioRef}
        src={playbackSrc || undefined}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => { setPlaying(true); setFailed(false); setReadyToPlay(false) }}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0 }}
        onError={(event) => { setPlaying(false); void refreshPlaybackUrl(event.currentTarget.error) }}
      />
      <button className="messages-voice-player__toggle" type="button" onClick={togglePlayback} disabled={failed || refreshing} aria-label={refreshing ? 'Refreshing voice note' : failed ? 'Voice note unavailable' : playing ? 'Pause voice note' : 'Play voice note'}>
        {refreshing ? <span className="messages-voice-note-spinner" /> : <Icon name={playing ? 'pause' : 'play'} size={17} />}
      </button>
      <div className="messages-voice-player__timeline">
        <div className="messages-voice-player__waveform" aria-hidden="true" style={{ '--voice-progress': `${progress * 100}%` }}>
          {bars.map((height, index) => <i className={index / bars.length <= progress ? 'is-played' : ''} key={index} style={{ '--bar-height': `${height}px` }} />)}
        </div>
        <input
          className="messages-voice-player__seek"
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={Math.min(currentTime, duration || 0)}
          onChange={seek}
          aria-label="Voice note playback position"
          aria-valuetext={`${formatVoiceTime(currentTime)} of ${formatVoiceTime(duration)}`}
          disabled={!duration || failed || refreshing}
        />
        <span className="messages-voice-player__time">{refreshing ? 'Loading audio…' : failed ? 'Unavailable' : readyToPlay ? 'Ready · tap to play' : `${formatVoiceTime(currentTime)} / ${formatVoiceTime(duration)}`}</span>
      </div>
    </div>
  )
}

function MessageImageViewer({ src, onClose }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return createPortal(
    <div className="messages-image-viewer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <button className="messages-image-viewer__close" type="button" aria-label="Close image" onClick={onClose}><Icon name="close" size={20} /></button>
      <img src={src} alt="Full-size chat attachment" />
    </div>,
    document.body,
  )
}

function GroupPeopleDialog({ conversation, currentUserId, onClose, onAdd, onLeave, onViewProfile }) {
  const [adding, setAdding] = useState(false)
  const [eligiblePeople, setEligiblePeople] = useState([])
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')
  const availableSlots = Math.max(0, 10 - (conversation.members?.length || 0))
  const visibleEligiblePeople = eligiblePeople.filter((person) => `${person.name} ${person.username}`.toLowerCase().includes(search.trim().toLowerCase()))

  useEffect(() => {
    if (!adding) return undefined
    let active = true
    setLoading(true)
    setError('')
    getAddableGroupMembers(conversation.id)
      .then(({ users }) => {
        if (active) setEligiblePeople(users)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'People you can add could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [adding, conversation.id])

  function toggleSelected(userId) {
    setSelectedIds((current) => {
      if (current.includes(userId)) return current.filter((id) => id !== userId)
      if (current.length >= availableSlots) {
        setError(`This group has room for ${availableSlots} more ${availableSlots === 1 ? 'person' : 'people'}.`)
        return current
      }
      setError('')
      return [...current, userId]
    })
  }

  async function submitMembers(event) {
    event.preventDefault()
    if (!selectedIds.length) return
    setSubmitting(true)
    setError('')
    try {
      await onAdd(conversation.id, selectedIds)
      onClose()
    } catch (requestError) {
      setError(requestError.message || 'The selected people could not be added.')
    } finally {
      setSubmitting(false)
    }
  }

  async function leave() {
    if (!window.confirm(`Leave ${conversation.groupName}? You will no longer receive messages from this group.`)) return
    setLeaving(true)
    setError('')
    try {
      await onLeave(conversation.id)
      onClose()
    } catch (requestError) {
      setError(requestError.message || 'You could not leave this group.')
      setLeaving(false)
    }
  }

  return (
    <div className="messages-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="messages-modal messages-group-dialog" role="dialog" aria-modal="true" aria-labelledby="messages-group-people-title">
        <div className="messages-modal__heading">
          <div><span className="messages-eyebrow">{conversation.groupName}</span><h2 id="messages-group-people-title">{adding ? 'Add people' : 'People in this group'}</h2></div>
          <button className="messages-icon-button" type="button" aria-label="Close group people" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        {adding ? <>
          <p className="messages-group-dialog__hint">You can add people without asking them first when you follow each other. Up to ten people can be in a group.</p>
          <label className="messages-group-search"><Icon name="search" size={16} /><span className="visually-hidden">Search mutual follows</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search mutual follows" /></label>
          <div className="messages-group-members" aria-label="People you follow who also follow you">
            {loading && <p className="messages-search-empty" role="status">Loading mutual follows…</p>}
            {!loading && visibleEligiblePeople.map((person) => {
              const selected = selectedIds.includes(person.id)
              return <button className={`messages-group-person${selected ? ' is-selected' : ''}`} type="button" key={person.id} aria-pressed={selected} onClick={() => toggleSelected(person.id)}>
                <PersonAvatar person={person} />
                <span><strong>{person.name}</strong><small>@{person.username}</small></span>
                <span className="messages-group-person__check" aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>
              </button>
            })}
            {!loading && visibleEligiblePeople.length === 0 && <p className="messages-search-empty">{!availableSlots ? 'This group is full.' : eligiblePeople.length ? 'No mutual follows match your search.' : 'No eligible mutual follows are available to add.'}</p>}
          </div>
          <div className="messages-group-selection" aria-live="polite">{selectedIds.length} selected · {availableSlots} spaces left</div>
          {error && <p className="messages-group-error" role="alert">{error}</p>}
          <div className="messages-modal__actions">
            <button className="messages-secondary-button" type="button" disabled={submitting} onClick={() => { setAdding(false); setError(''); setSelectedIds([]) }}>Back</button>
            <button className="messages-primary-button" type="button" disabled={submitting || loading || selectedIds.length === 0} onClick={submitMembers}>{submitting ? 'Adding…' : 'Add selected'}</button>
          </div>
        </> : <>
          <div className="messages-group-members" aria-label="Group members">
            {(conversation.members || []).map((member) => <button className="messages-group-person" type="button" key={member.id} onClick={() => onViewProfile(member.username)}>
              <PersonAvatar person={member} />
              <span><strong>{member.name}{member.id === currentUserId ? ' (you)' : ''}</strong><small>@{member.username}</small></span>
              <Icon name="chevron" size={15} />
            </button>)}
          </div>
          {error && <p className="messages-group-error" role="alert">{error}</p>}
          <div className="messages-modal__actions messages-group-people__actions">
            <button className="messages-text-button messages-text-button--remove" type="button" disabled={leaving} onClick={leave}>{leaving ? 'Leaving…' : 'Leave group'}</button>
            <button className="messages-secondary-button" type="button" onClick={onClose}>Close</button>
            <button className="messages-primary-button" type="button" disabled={!availableSlots} onClick={() => setAdding(true)}>Add people</button>
          </div>
        </>}
      </section>
    </div>
  )
}

function ChatPanel({ conversation, conversations, messages, reactions, onSend, onSendVoiceNote, onRefreshVoiceNote, onStartCall, callActive, onReact, onDeleteForEveryone, onForward, onNickname, onBlock, onMute, onReport, onAddGroupMembers, onLeaveGroup, userId, composerRef, onBack, onViewProfile, onTypingChange, isTyping, connectionState, initialDraft = null, onInitialDraftUsed }) {
  const scrollRef = useRef(null)
  const [draft, setDraft] = useState('')
  const [selectedImage, setSelectedImage] = useState(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const [imageSending, setImageSending] = useState(false)
  const [viewingImage, setViewingImage] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [nicknameOpen, setNicknameOpen] = useState(false)
  const [nicknamePermissionOpen, setNicknamePermissionOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [groupPeopleOpen, setGroupPeopleOpen] = useState(false)
  const [conversationNotice, setConversationNotice] = useState('')
  const [voiceStatus, setVoiceStatus] = useState('')
  const [voiceNoteRecording, setVoiceNoteRecording] = useState(false)
  const [voiceNoteBlob, setVoiceNoteBlob] = useState(null)
  const [voiceNoteUrl, setVoiceNoteUrl] = useState('')
  const [voiceNoteStarting, setVoiceNoteStarting] = useState(false)
  const [voiceNoteSending, setVoiceNoteSending] = useState(false)
  const [voiceNoteSeconds, setVoiceNoteSeconds] = useState(0)
  const voiceRecorderRef = useRef(null)
  const voiceStreamRef = useRef(null)
  const voiceChunksRef = useRef([])
  const voiceBytesRef = useRef(0)
  const voiceOperationRef = useRef(0)
  const voiceStartingRef = useRef(false)
  const voiceNoteTooLargeRef = useRef(false)
  const initialMessageAttemptRef = useRef('')
  const fileInputRef = useRef(null)
  const messagesForChat = messages[conversation.id] || conversation.messages

  useEffect(() => {
    if (!initialDraft?.text || (isApiEnabled() && connectionState !== 'connected')) return
    const messageKey = `${conversation.id}:${initialDraft.id}`
    const attemptKey = `${messageKey}:${connectionState}`
    if (initialMessageAttemptRef.current === attemptKey) return
    initialMessageAttemptRef.current = attemptKey
    onSend(conversation.id, initialDraft.text, null, null, initialDraft.contextLabel)
      .then((sent) => {
        if (sent) {
          onInitialDraftUsed()
          setAttachmentError('')
        } else {
          setAttachmentError('Your story reply could not be sent. Reconnect and try again.')
        }
      })
      .catch((error) => setAttachmentError(error.message || 'Your story reply could not be sent.'))
  }, [connectionState, conversation.id, initialDraft, onInitialDraftUsed, onSend])

  useEffect(() => {
    if (selectedImage && imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setSelectedImage(null)
    setImagePreviewUrl('')
    setAttachmentError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [conversation.id])

  useEffect(() => {
    setVoiceNoteStarting(false)
    setVoiceNoteRecording(false)
    setVoiceNoteBlob(null)
    setVoiceNoteUrl('')
    setVoiceNoteSeconds(0)
    setVoiceStatus('')
    voiceNoteTooLargeRef.current = false
    return () => {
      voiceOperationRef.current += 1
      voiceStartingRef.current = false
      if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
        voiceRecorderRef.current.onstop = null
        voiceRecorderRef.current.stop()
      }
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
      voiceStreamRef.current = null
      voiceRecorderRef.current = null
      voiceChunksRef.current = []
      voiceBytesRef.current = 0
    }
  }, [conversation.id, conversation.blocked])

  useEffect(() => () => {
    if (voiceNoteUrl) URL.revokeObjectURL(voiceNoteUrl)
  }, [voiceNoteUrl])

  useEffect(() => {
    if (!voiceNoteRecording) return undefined
    const timer = window.setInterval(() => setVoiceNoteSeconds((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [voiceNoteRecording])

  useEffect(() => {
    const container = scrollRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [conversation.id, messagesForChat.length])

  async function submit(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text && !selectedImage) return
    setAttachmentError('')
    setImageSending(true)
    let image = null
    try {
      if (selectedImage) {
        if (isApiEnabled()) {
          const uploaded = await uploadMedia(selectedImage)
          image = { url: uploaded.url, assetId: uploaded.assetId, mediaType: uploaded.resourceType }
        } else {
          image = { url: imagePreviewUrl, mediaType: 'image' }
        }
      }
      const sent = await onSend(conversation.id, text, replyTo, image)
      if (!sent) return
      onTypingChange(conversation.id, false)
      setDraft('')
      if (selectedImage && isApiEnabled()) URL.revokeObjectURL(imagePreviewUrl)
      setSelectedImage(null)
      setImagePreviewUrl('')
      setReplyTo(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (error) {
      setAttachmentError(error.message || 'The image could not be sent. Try again.')
    } finally {
      setImageSending(false)
    }
  }

  function selectImage(file) {
    setAttachmentError('')
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setAttachmentError('Choose a JPG, PNG, WebP, or GIF image.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setAttachmentError('Images must be 10 MB or smaller.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (selectedImage && imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setSelectedImage(file)
    setImagePreviewUrl(URL.createObjectURL(file))
  }

  async function startVoiceNoteRecording() {
    if (voiceStartingRef.current || voiceNoteStarting || voiceNoteRecording || voiceNoteBlob) return
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceStatus('Voice recording is not supported in this browser.')
      return
    }
    const operation = ++voiceOperationRef.current
    voiceStartingRef.current = true
    let stream
    setVoiceNoteStarting(true)
    setVoiceStatus('Waiting for microphone access…')
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (operation !== voiceOperationRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const mimeType = typeof window.MediaRecorder.isTypeSupported === 'function'
        ? ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
          .find((type) => window.MediaRecorder.isTypeSupported(type))
        : undefined
      const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      voiceChunksRef.current = []
      voiceBytesRef.current = 0
      voiceNoteTooLargeRef.current = false
      voiceStreamRef.current = stream
      voiceRecorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (!event.data.size || voiceNoteTooLargeRef.current) return
        if (voiceBytesRef.current + event.data.size > MAX_VOICE_NOTE_BYTES) {
          voiceNoteTooLargeRef.current = true
          recorder.stop()
          return
        }
        voiceBytesRef.current += event.data.size
        voiceChunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        recorder.onstop = null
        voiceChunksRef.current = []
        voiceBytesRef.current = 0
        setVoiceStatus('The voice note could not be recorded. Try again.')
        setVoiceNoteRecording(false)
        stream.getTracks().forEach((track) => track.stop())
        voiceStreamRef.current = null
        voiceRecorderRef.current = null
      }
      recorder.onstop = () => {
        if (voiceNoteTooLargeRef.current) {
          voiceChunksRef.current = []
          voiceBytesRef.current = 0
          stream.getTracks().forEach((track) => track.stop())
          voiceStreamRef.current = null
          voiceRecorderRef.current = null
          setVoiceNoteRecording(false)
          setVoiceStatus('Voice notes must be 20 MB or smaller. Record a shorter note and try again.')
          return
        }
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        voiceChunksRef.current = []
        voiceBytesRef.current = 0
        stream.getTracks().forEach((track) => track.stop())
        voiceStreamRef.current = null
        voiceRecorderRef.current = null
        setVoiceNoteRecording(false)
        if (!blob.size) {
          setVoiceStatus('No audio was recorded. Check your microphone and try again.')
          return
        }
        const previewUrl = URL.createObjectURL(blob)
        setVoiceNoteUrl(previewUrl)
        setVoiceNoteBlob(blob)
        setVoiceStatus('')
      }
      recorder.start(250)
      setVoiceStatus('')
      setVoiceNoteSeconds(0)
      setVoiceNoteRecording(true)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      voiceStreamRef.current = null
      voiceRecorderRef.current = null
      const message = error.name === 'NotAllowedError'
        ? 'Allow microphone access in your browser to record a voice note.'
        : error.name === 'NotFoundError'
          ? 'No microphone was found. Connect one and try again.'
          : 'The microphone could not be started. Check your device and try again.'
      setVoiceStatus(message)
    } finally {
      if (operation === voiceOperationRef.current) {
        voiceStartingRef.current = false
        setVoiceNoteStarting(false)
      }
    }
  }

  function stopVoiceNoteRecording() {
    if (voiceRecorderRef.current?.state === 'recording') voiceRecorderRef.current.stop()
  }

  function cancelVoiceNote() {
    voiceOperationRef.current += 1
    voiceStartingRef.current = false
    if (voiceRecorderRef.current?.state === 'recording') {
      voiceRecorderRef.current.onstop = null
      voiceRecorderRef.current.stop()
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
    voiceStreamRef.current = null
    voiceRecorderRef.current = null
    voiceChunksRef.current = []
    voiceBytesRef.current = 0
    voiceNoteTooLargeRef.current = false
    setVoiceNoteStarting(false)
    if (voiceNoteUrl) URL.revokeObjectURL(voiceNoteUrl)
    setVoiceNoteRecording(false)
    setVoiceNoteBlob(null)
    setVoiceNoteUrl('')
    setVoiceStatus('')
  }

  async function sendRecordedVoiceNote() {
    if (!voiceNoteBlob || voiceNoteSending) return
    if (voiceNoteBlob.size > MAX_VOICE_NOTE_BYTES) {
      setVoiceStatus('This recording is too large to send. Record a shorter voice note.')
      return
    }
    setVoiceNoteSending(true)
    try {
      await onSendVoiceNote(conversation.id, voiceNoteBlob)
      cancelVoiceNote()
    } catch (error) {
      setVoiceStatus(error.message || 'The voice note could not be sent. Try again.')
    } finally {
      setVoiceNoteSending(false)
    }
  }

  return (
    <section className="messages-chat" aria-label={`Conversation with ${conversation.name}`}>
      <header className="messages-chat__header">
        <button className="messages-icon-button messages-chat__back" type="button" aria-label="Back to conversations" onClick={onBack}><Icon name="back" size={19} /></button>
        <PersonAvatar person={conversation} onClick={conversation.profileId ? () => onViewProfile(conversation.profileId) : undefined} />
        <span className="messages-chat__identity">
          <strong>{conversation.nickname || conversation.name}</strong>
          <small>{connectionState !== 'connected' ? 'Reconnecting…' : <>{conversation.handle}<i className={conversation.online ? 'is-online' : ''} />{conversation.online ? 'Online' : 'Away'}</>}</small>
          {isTyping && <small className="messages-typing" role="status">Typing…</small>}
        </span>
        <div className="messages-chat__call-actions" aria-label="Calls">
          <button className="messages-icon-button" type="button" aria-label="Start voice call" title="Voice call" disabled={!conversation.profileId || callActive || conversation.blocked} onClick={() => onStartCall(conversation, 'audio')}><Icon name="phone" size={18} /></button>
          <button className="messages-icon-button" type="button" aria-label="Start video call" title="Video call" disabled={!conversation.profileId || callActive || conversation.blocked} onClick={() => onStartCall(conversation, 'video')}><Icon name="video" size={18} /></button>
        </div>
        <ConversationMenu
          conversation={conversation}
          onNickname={(remove = false) => {
            if (remove) onNickname(conversation, '').catch((error) => setConversationNotice(error.message || 'The nickname could not be removed.'))
            else setNicknameOpen(true)
          }}
          onBlock={onBlock}
          onMute={onMute}
          onReport={() => setReportOpen(true)}
          onNicknamePermission={() => setNicknamePermissionOpen(true)}
          onSeePeople={() => setGroupPeopleOpen(true)}
        />
      </header>
      {conversation.blocked && <div className="messages-blocked-notice" role="status">You blocked {conversation.nickname || conversation.name}. Unblock them from conversation options to continue messaging.</div>}
      {conversationNotice && <div className="messages-blocked-notice" role="status">{conversationNotice}</div>}
      <div className="messages-chat__history" ref={scrollRef} aria-live="polite">
        <div className="messages-chat__intro">
          <PersonAvatar person={conversation} className="messages-chat__intro-avatar" onClick={conversation.profileId ? () => onViewProfile(conversation.profileId) : undefined} />
          <strong>{conversation.nickname || conversation.name}</strong>
          <span>{conversation.handle}</span>
          <small>{conversation.online ? 'Online now' : 'Your conversation'}</small>
        </div>
        <div className="messages-chat__day">TODAY</div>
        {messagesForChat.map((message) => (
          <div className={`messages-bubble-row${message.from === 'me' ? ' is-outgoing' : ''}`} key={message.id}>
            {message.from === 'them' && <PersonAvatar person={conversation} className="messages-bubble__avatar" onClick={conversation.profileId ? () => onViewProfile(conversation.profileId) : undefined} />}
            <div className="messages-bubble-wrap">
              {messageContextLabel(message) && !message.unsent && <strong className="messages-story-reply-label">{messageContextLabel(message)}</strong>}
              {message.replyTo && <div className="messages-bubble__reply-preview"><strong>{message.replyTo.name}</strong><span>{message.replyTo.text}</span></div>}
              <div className={`messages-bubble${message.from === 'me' ? ' messages-bubble--outgoing' : ''}${message.unsent ? ' messages-bubble--unsent' : ''}`}>
                {message.forwarded && <small className="messages-bubble__forwarded">Forwarded</small>}
                {message.unsent
                  ? <p>Message unsent</p>
                  : <>
                    {message.voiceNoteUrl
                      ? <VoiceNotePlayer src={message.voiceNoteUrl} outgoing={message.from === 'me'} onRefresh={() => onRefreshVoiceNote(conversation.id, message.id)} onError={(error) => setVoiceStatus(error?.message || 'This voice note is unavailable.')} />
                      : <>
                      {message.imageUrl && <button className="messages-bubble__image-button" type="button" aria-label="View attached image full size" onClick={() => setViewingImage(message.imageUrl)}><img className="messages-bubble__image" src={message.imageUrl} alt="Image attached to message" loading="lazy" /></button>}
                      {message.text && <p>{message.text}</p>}
                      </>}
                    </>}
                {!message.unsent && <time>{message.time}</time>}
              </div>
              {!message.unsent && <MessageActions
                message={message}
                conversations={conversations.filter((item) => item.id !== conversation.id && !item.blocked)}
                reacted={Boolean(reactions[message.id])}
                onReply={() => { setReplyTo(message); composerRef.current?.focus() }}
                onReact={() => onReact(message.id)}
                onDeleteForEveryone={() => onDeleteForEveryone(conversation.id, message.id)}
                onForward={(targetId) => onForward(targetId, message)}
                onViewProfile={onViewProfile}
              />}
            </div>
          </div>
        ))}
      </div>
      {replyTo && <div className="messages-replying"><span><strong>Replying to {replyTo.from === 'me' ? 'yourself' : conversation.nickname || conversation.name}</strong><small>{replyTo.text}</small></span><button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><Icon name="close" size={15} /></button></div>}
      {voiceNoteRecording && <div className="messages-voice-note-composer is-recording" role="status">
        <span className="messages-voice-note-composer__indicator" aria-hidden="true" />
        <span className="messages-voice-note-composer__label"><strong>Recording voice note</strong><small>{formatVoiceTime(voiceNoteSeconds)} · Speak naturally</small></span>
        <span className="messages-voice-note-composer__live-wave" aria-hidden="true">{[8, 14, 22, 12, 18, 26, 15, 21, 10, 18, 25, 12, 20, 9, 17, 24, 14, 19, 11, 22, 15, 8, 20, 13].map((height, index) => <i key={index} style={{ '--bar-height': `${height}px`, '--wave-index': index }} />)}</span>
        <button className="messages-voice-note-composer__cancel" type="button" onClick={cancelVoiceNote}>Cancel</button>
        <button className="messages-voice-note-composer__stop" type="button" onClick={stopVoiceNoteRecording}><Icon name="check" size={15} /> Finish</button>
      </div>}
      {voiceNoteUrl && <div className="messages-voice-note-composer is-preview">
        <div className="messages-voice-note-composer__heading"><span><strong>Voice note ready</strong><small>Preview it before sending</small></span><button className="messages-voice-note-composer__cancel" type="button" onClick={cancelVoiceNote} disabled={voiceNoteSending} aria-label="Discard voice note"><Icon name="close" size={16} /></button></div>
        <VoiceNotePlayer src={voiceNoteUrl} preview onError={() => setVoiceStatus('The recording preview could not be played. Try recording again.')} />
        <div className="messages-voice-note-composer__actions"><button className="messages-voice-note-composer__cancel" type="button" onClick={cancelVoiceNote} disabled={voiceNoteSending}>Discard</button><button className="messages-voice-note-composer__send" type="button" onClick={sendRecordedVoiceNote} disabled={voiceNoteSending}>{voiceNoteSending ? <><span className="messages-voice-note-spinner" /> Sending…</> : <><Icon name="send" size={15} /> Send voice note</>}</button></div>
      </div>}
      <form className={`messages-composer${conversation.blocked ? ' is-disabled' : ''}`} onSubmit={submit}>
        <button className="messages-icon-button" type="button" aria-label="Add a smile" onClick={() => setDraft((current) => `${current}${current ? ' ' : ''}😊`)}><Icon name="emoji" size={19} /></button>
        <button className="messages-icon-button messages-composer__attach" type="button" aria-label="Attach an image" onClick={() => fileInputRef.current?.click()}><Icon name="image" size={19} /></button>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={conversation.blocked || imageSending} onChange={(event) => selectImage(event.target.files?.[0])} />
        <label className="visually-hidden" htmlFor={`message-input-${conversation.id}`}>Write a message...</label>
        <input id={`message-input-${conversation.id}`} ref={composerRef} className="messages-composer__input" value={draft} onChange={(event) => { setDraft(event.target.value); onTypingChange(conversation.id, Boolean(event.target.value)) }} placeholder={conversation.blocked ? 'Unblock to send a message' : 'Write a message...'} autoComplete="off" disabled={conversation.blocked} />
        <button className={`messages-icon-button messages-composer__voice-note${voiceNoteRecording ? ' is-listening' : ''}`} type="button" aria-label={voiceNoteStarting ? 'Waiting for microphone' : voiceNoteRecording ? 'Recording voice note' : 'Record voice note'} title={voiceNoteStarting ? 'Waiting for microphone' : voiceNoteRecording ? 'Recording voice note' : 'Record voice note'} aria-pressed={voiceNoteRecording} onClick={startVoiceNoteRecording} disabled={conversation.blocked || voiceNoteStarting || voiceNoteRecording || Boolean(voiceNoteBlob)}><Icon name="microphone" size={18} /></button>
        <button className="messages-composer__send" type="submit" disabled={conversation.blocked || imageSending || (!draft.trim() && !selectedImage)} aria-label="Send message">{imageSending ? <span className="messages-voice-note-spinner" /> : <Icon name="send" size={18} />}</button>
      </form>
      {voiceStatus && <span className="messages-composer__voice-status" role="status">{voiceStatus}</span>}
      {attachmentError && <span className="messages-composer__voice-status" role="alert">{attachmentError}</span>}
      {selectedImage && <div className="messages-image-preview">
        <img src={imagePreviewUrl} alt="Selected image preview" />
        <span>{selectedImage.name}</span>
        <button type="button" aria-label="Remove attached image" disabled={imageSending} onClick={() => { URL.revokeObjectURL(imagePreviewUrl); setSelectedImage(null); setImagePreviewUrl(''); if (fileInputRef.current) fileInputRef.current.value = '' }}><Icon name="close" size={15} /></button>
      </div>}
      {viewingImage && <MessageImageViewer src={viewingImage} onClose={() => setViewingImage('')} />}
      {nicknameOpen && <NicknameDialog conversation={conversation} onClose={() => setNicknameOpen(false)} onSave={(nickname) => onNickname(conversation, nickname)} />}
      {nicknamePermissionOpen && <NicknamePermissionDialog userId={userId} onClose={() => setNicknamePermissionOpen(false)} />}
      {groupPeopleOpen && <GroupPeopleDialog
        conversation={conversation}
        currentUserId={userId}
        onClose={() => setGroupPeopleOpen(false)}
        onViewProfile={onViewProfile}
        onAdd={onAddGroupMembers}
        onLeave={onLeaveGroup}
      />}
      {reportOpen && <ReportConversationDialog
        conversation={conversation}
        targets={conversation.members?.filter((member) => member.id !== userId) || (conversation.profileId ? [{ id: conversation.profileId, name: conversation.name, username: conversation.handle?.replace(/^@/, '') || '' }] : [])}
        onClose={() => setReportOpen(false)}
        onSubmit={async (targetId, report) => {
        await onReport(targetId, report)
        setConversationNotice('Your report was submitted for review.')
      }} />}
    </section>
  )
}

function ConversationMenu({ conversation, onNickname, onBlock, onMute, onReport, onNicknamePermission, onSeePeople }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="messages-menu">
      <button className="messages-icon-button" type="button" aria-label="Conversation options" aria-expanded={open} onClick={() => setOpen((current) => !current)}><Icon name="more" size={19} /></button>
      {open && <div className="messages-menu__popover" role="menu">
        <span>Conversation options</span>
        {!conversation.groupName && <button type="button" role="menuitem" onClick={() => { setOpen(false); onNickname() }}>{conversation.nickname ? 'Edit nickname' : 'Add nickname'}</button>}
        {!conversation.groupName && conversation.nickname && <button type="button" role="menuitem" onClick={() => { onNickname(true); setOpen(false) }}>Remove nickname</button>}
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onMute(conversation.id, !conversation.muted) }}>{conversation.muted ? 'Unmute messages' : 'Mute messages'}</button>
        {conversation.groupName && <button type="button" role="menuitem" onClick={() => { setOpen(false); onSeePeople() }}>See people</button>}
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onNicknamePermission() }}>Who can nickname me</button>
        {(conversation.profileId || conversation.members?.length > 1) && <button type="button" role="menuitem" className="is-danger" onClick={() => { setOpen(false); onReport() }}>{conversation.groupName ? 'Report a member' : 'Report account'}</button>}
        <button type="button" role="menuitem" className={conversation.blocked ? '' : 'is-danger'} onClick={() => { onBlock(conversation.id); setOpen(false) }}>{conversation.blocked ? 'Unblock' : `Block ${conversation.nickname || conversation.name}`}</button>
      </div>}
    </div>
  )
}

function MessageActions({ message, conversations, reacted, onReply, onReact, onDeleteForEveryone, onForward, onViewProfile }) {
  const [open, setOpen] = useState(false)
  const [forwarding, setForwarding] = useState(false)
  return (
    <div className="messages-bubble-actions">
      <button className={`messages-bubble-action${reacted ? ' is-reacted' : ''}`} type="button" aria-label={reacted ? 'Remove reaction' : 'React with heart'} aria-pressed={reacted} onClick={onReact}><Icon name="heart" size={13} /></button>
      <button className="messages-bubble-action" type="button" aria-label="Reply to message" onClick={onReply}><Icon name="reply" size={14} /></button>
      <div className="messages-menu">
        <button className="messages-bubble-action" type="button" aria-label="Message options" aria-expanded={open} onClick={() => setOpen((current) => !current)}><Icon name="more" size={14} /></button>
        {open && <div className="messages-menu__popover messages-menu__popover--message" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setForwarding(true) }}>Forward</button>
          {message.from === 'me' && <button type="button" role="menuitem" className="is-danger" onClick={() => { onDeleteForEveryone(); setOpen(false) }}>Delete for everyone</button>}
        </div>}
      </div>
      {reacted && <span className="messages-bubble-reaction" aria-label="You reacted with a heart">♥</span>}
      {forwarding && <ForwardMessageDialog
        message={message}
        conversations={conversations}
        onViewProfile={onViewProfile}
        onClose={() => setForwarding(false)}
        onForward={(conversationId) => { onForward(conversationId); setForwarding(false) }}
      />}
    </div>
  )
}

function ForwardMessageDialog({ message, conversations, onClose, onForward, onViewProfile }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return createPortal(
    <div className="messages-modal-backdrop messages-forward-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="messages-modal messages-forward-dialog" role="dialog" aria-modal="true" aria-labelledby="messages-forward-title">
        <div className="messages-modal__heading">
          <div><span className="messages-eyebrow">SHARE A MESSAGE</span><h2 id="messages-forward-title">Forward to</h2></div>
          <button className="messages-icon-button" type="button" aria-label="Close forward dialog" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <p className="messages-forward-dialog__preview">{message.text}</p>
        <div className="messages-forward-dialog__targets" aria-label="Choose a conversation">
          {conversations.map((conversation) => <div className="messages-forward-recipient" key={conversation.id}>
            <ProfilePhotoButton person={conversation} onViewProfile={onViewProfile}><PersonAvatar person={conversation} /></ProfilePhotoButton>
            <button type="button" onClick={() => onForward(conversation.id)}>
              <span><strong>{conversation.nickname || conversation.name}</strong><small>{conversation.handle}</small></span>
              <Icon name="chevron" size={16} />
            </button>
          </div>)}
          {conversations.length === 0 && <p>No other conversations to forward to.</p>}
        </div>
      </section>
    </div>,
    document.body,
  )
}

function NicknameDialog({ conversation, onClose, onSave }) {
  const [nickname, setNickname] = useState(conversation.nickname || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave(nickname.trim())
      onClose()
    } catch (requestError) {
      setError(requestError.message || 'The nickname could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="messages-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="messages-modal messages-nickname-dialog" role="dialog" aria-modal="true" aria-labelledby="messages-nickname-title" onSubmit={submit}>
        <div className="messages-modal__heading"><div><span className="messages-eyebrow">THIS CONVERSATION</span><h2 id="messages-nickname-title">Set a nickname</h2></div><button className="messages-icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <label htmlFor="messages-nickname-input">Nickname for {conversation.name}</label>
        <input id="messages-nickname-input" className="messages-nickname-input" maxLength={32} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder={conversation.name} autoFocus />
        {error && <p className="messages-group-error" role="alert">{error}</p>}
        <div className="messages-modal__actions"><button className="messages-secondary-button" type="button" onClick={onClose}>Cancel</button><button className="messages-primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
      </form>
    </div>
  )
}

function NicknamePermissionDialog({ userId, onClose }) {
  const storageKey = `sonrisetalk-nickname-permission-${userId || 'guest'}`
  const [permission, setPermission] = useState('everyone')
  const [loading, setLoading] = useState(isApiEnabled())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isApiEnabled()) {
      try {
        setPermission(window.localStorage.getItem(storageKey) || 'everyone')
      } catch (storageError) {
        setError(storageError.message || 'Nickname permissions could not be loaded.')
      }
      return
    }
    let active = true
    getPrivacySettings()
      .then(({ privacy }) => {
        if (active) setPermission(privacy.allowNicknamesFrom || 'everyone')
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Nickname permissions could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [storageKey])

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (isApiEnabled()) await updatePrivacySettings({ allowNicknamesFrom: permission })
      else window.localStorage.setItem(storageKey, permission)
      onClose()
    } catch (requestError) {
      setError(requestError.message || 'Nickname permissions could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="messages-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="messages-modal messages-nickname-dialog" role="dialog" aria-modal="true" aria-labelledby="messages-nickname-permission-title" onSubmit={save}>
        <div className="messages-modal__heading"><div><span className="messages-eyebrow">ACCOUNT PRIVACY</span><h2 id="messages-nickname-permission-title">Who can nickname me?</h2></div><button className="messages-icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <label className="messages-nickname-permission-option"><input type="radio" name="nickname-permission" value="everyone" checked={permission === 'everyone'} onChange={() => setPermission('everyone')} disabled={loading || Boolean(error)} /><span><strong>Everyone</strong><small>Anyone you message can set a nickname for you.</small></span></label>
        <label className="messages-nickname-permission-option"><input type="radio" name="nickname-permission" value="following" checked={permission === 'following'} onChange={() => setPermission('following')} disabled={loading || Boolean(error)} /><span><strong>People I follow</strong><small>Only accounts you follow can set a nickname for you.</small></span></label>
        <label className="messages-nickname-permission-option"><input type="radio" name="nickname-permission" value="nobody" checked={permission === 'nobody'} onChange={() => setPermission('nobody')} disabled={loading || Boolean(error)} /><span><strong>Nobody</strong><small>Do not allow anyone to set a nickname for you.</small></span></label>
        {error && <p className="messages-group-error" role="alert">{error}</p>}
        <div className="messages-modal__actions"><button className="messages-secondary-button" type="button" onClick={onClose}>Cancel</button><button className="messages-primary-button" type="submit" disabled={saving || loading || Boolean(error)}>{loading ? 'Loading…' : saving ? 'Saving…' : 'Save'}</button></div>
      </form>
    </div>
  )
}

function ReportConversationDialog({ conversation, targets, onClose, onSubmit }) {
  const [reason, setReason] = useState('spam')
  const [details, setDetails] = useState('')
  const [targetId, setTargetId] = useState(targets[0]?.id || '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(targetId, { reason, details: details.trim() })
      onClose()
    } catch (requestError) {
      setError(requestError.message || 'The report could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="messages-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="messages-modal messages-nickname-dialog" role="dialog" aria-modal="true" aria-labelledby="messages-report-title" onSubmit={submit}>
        <div className="messages-modal__heading"><div><span className="messages-eyebrow">{conversation.groupName ? conversation.groupName : `@${conversation.handle?.replace(/^@/, '')}`}</span><h2 id="messages-report-title">Report account</h2></div><button className="messages-icon-button" type="button" aria-label="Close report dialog" onClick={onClose}><Icon name="close" size={18} /></button></div>
        {targets.length > 1 && <label htmlFor="messages-report-account">Choose an account
          <select id="messages-report-account" className="messages-nickname-input" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            {targets.map((target) => <option key={target.id} value={target.id}>{target.name} (@{target.username})</option>)}
          </select>
        </label>}
        <label htmlFor="messages-report-reason">Why are you reporting this account?</label>
        <select id="messages-report-reason" className="messages-nickname-input" value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="spam">Spam or scam</option><option value="harassment">Harassment or bullying</option><option value="impersonation">Impersonation</option><option value="inappropriate">Inappropriate content</option><option value="other">Something else</option>
        </select>
        <label htmlFor="messages-report-details">Details (optional)</label>
        <textarea id="messages-report-details" className="messages-nickname-input" maxLength={1000} rows={4} value={details} onChange={(event) => setDetails(event.target.value)} />
        {error && <p className="messages-group-error" role="alert">{error}</p>}
        <div className="messages-modal__actions"><button className="messages-secondary-button" type="button" onClick={onClose}>Cancel</button><button className="messages-primary-button" type="submit" disabled={submitting || !targetId}>{submitting ? 'Submitting…' : 'Submit report'}</button></div>
      </form>
    </div>
  )
}

export default function MessagesPage({ onMobileChatChange, openProfile, onViewProfile, onStartCall, callActive = false, currentUser = { id: '', name: '', username: '' } }) {
  const callManager = useContext(CallManagerContext)
  const usesApi = isApiEnabled()
  const [conversations, setConversations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [conversationOpen, setConversationOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [ownNote, setOwnNote] = useState(null)
  const [notes, setNotes] = useState([])
  const [noteEditorOpen, setNoteEditorOpen] = useState(false)
  const [noteViewer, setNoteViewer] = useState(null)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [messages, setMessages] = useState({})
  const [reactions, setReactions] = useState({})
  const [connectionState, setConnectionState] = useState(usesApi ? 'connecting' : 'connected')
  const [messagingError, setMessagingError] = useState('')
  const [pendingStoryReply, setPendingStoryReply] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(usesApi)
  const [typingByConversation, setTypingByConversation] = useState({})
  const socketRef = useRef(null)
  const typingTimerRef = useRef(null)
  const selectedIdRef = useRef(selectedId)
  const conversationsRef = useRef(conversations)
  const composerRef = useRef(null)
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId)
  conversationsRef.current = conversations

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  function openNoteViewer(note) {
    setNoteViewer(note)
  }

  const reloadConversations = useCallback(() => getConversations()
    .then(({ conversations: nextConversations }) => {
      setConversations(nextConversations)
      setMessages((current) => {
        const next = { ...current }
        for (const conversation of nextConversations) {
          next[conversation.id] ??= conversation.messages
        }
        return next
      })
      return nextConversations
    }), [])

  function removeDeletedMessage(conversationId, messageId) {
    setMessages((current) => ({
      ...current,
      [conversationId]: (current[conversationId] || []).filter((message) => message.id !== messageId),
    }))
    setReactions((current) => {
      const next = { ...current }
      delete next[messageId]
      return next
    })
    if (!usesApi) return
    Promise.all([reloadConversations(), getMessages(conversationId)])
      .then(([, { messages: refreshedMessages }]) => {
        setMessages((current) => ({ ...current, [conversationId]: refreshedMessages }))
      })
      .catch((error) => {
        setMessagingError(error.message || 'The conversation list could not be refreshed.')
      })
  }

  useEffect(() => {
    if (!usesApi) {
      setConversations([])
      setMessages({})
      setOwnNote(null)
      setNotes([])
      setSelectedId(null)
      setLoadingConversations(false)
      setConnectionState('disconnected')
      return undefined
    }
    let active = true
    reloadConversations()
      .then((nextConversations) => {
        if (!active) return
        if (!window.matchMedia('(max-width: 760px)').matches && nextConversations.length) {
          setSelectedId(nextConversations[0].id)
        }
      })
      .catch((error) => {
        if (active) setMessagingError(error.message || 'Your conversations could not load.')
      })
      .finally(() => {
        if (active) setLoadingConversations(false)
      })
    getNotes()
      .then(({ notes: nextNotes }) => {
        if (!active) return
        const mappedNotes = nextNotes.map((note) => ({
          ...note.user,
          id: note.id,
          userId: note.user.id,
          noteId: note.id,
          text: note.content,
          audience: note.audience,
          own: note.user.id === currentUser.id,
          timeRemaining: `${Math.max(1, Math.ceil((new Date(note.expiresAt).getTime() - Date.now()) / 3600000))}h left`,
        }))
        setOwnNote(mappedNotes.find((note) => note.own) || null)
        setNotes(mappedNotes.filter((note) => !note.own))
      })
      .catch((error) => {
        if (active) setMessagingError(error.message || 'Notes could not load.')
      })
    return () => { active = false }
  }, [currentUser.id, reloadConversations, usesApi])

  useEffect(() => {
    if (!usesApi) return undefined
    let active = true
    let socket
    createRealtimeSocket()
      .then((connection) => {
        if (!active) {
          connection.disconnect()
          return
        }
        socket = connection
        socketRef.current = connection
        connection.on('connect', () => setConnectionState('connected'))
        connection.on('disconnect', () => setConnectionState('reconnecting'))
        connection.on('connect_error', (error) => {
          setConnectionState('reconnecting')
          if (error.message === 'UNAUTHENTICATED') setMessagingError('Your session expired. Sign in again to use messages.')
        })
        connection.on('message:new', (message) => {
          const mapped = {
            id: message.id,
            from: message.senderId === currentUser.id ? 'me' : 'them',
            text: message.content,
            contextLabel: message.contextLabel === 'story_reply'
              ? message.senderId === currentUser.id ? 'You replied to their story' : 'Replied to your story'
              : message.contextLabel,
            time: new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(message.createdAt)),
            createdAt: message.createdAt,
            deliveredAt: message.deliveredAt,
            readAt: message.readAt,
            voiceNoteUrl: message.voiceNoteUrl,
            voiceNoteMimeType: message.voiceNoteMimeType,
            imageUrl: message.imageUrl,
            imageAssetId: message.imageAssetId,
          }
          setMessages((current) => {
            const existing = current[message.conversationId] || []
            if (existing.some((item) => item.id === mapped.id)) return current
            return { ...current, [message.conversationId]: [...existing, mapped] }
          })
          setConversations((current) => current.map((item) => item.id === message.conversationId
            ? { ...item, time: mapped.time,             unread: item.id === selectedIdRef.current || mapped.from === 'me' ? 0 : item.unread + 1 }
            : item))
        })
        connection.on('message:deleted', ({ conversationId, messageId }) => {
          removeDeletedMessage(conversationId, messageId)
        })
        connection.on('conversation:members', ({ conversationId }) => {
          if (conversationsRef.current.some((item) => item.id === conversationId)) {
            reloadConversations().catch((error) => setMessagingError(error.message || 'Group members could not be refreshed.'))
          }
        })
        connection.on('conversation:removed', ({ conversationId }) => {
          connection.emit('conversation:leave', { conversationId })
          setGroupPeopleOpen(false)
          reloadConversations()
            .then((updated) => {
              if (selectedIdRef.current === conversationId) {
                setSelectedId(updated[0]?.id || null)
                setConversationOpen(false)
              }
            })
            .catch((error) => setMessagingError(error.message || 'Your conversations could not be refreshed.'))
        })
        connection.on('conversation:typing', ({ conversationId, userId, typing }) => {
          if (userId === currentUser.id) return
          setTypingByConversation((current) => ({ ...current, [conversationId]: typing }))
        })
        connection.on('conversation:read', ({ conversationId, userId, readAt }) => {
          if (userId === currentUser.id) return
          setMessages((current) => ({
            ...current,
            [conversationId]: (current[conversationId] || []).map((message) => message.from === 'me'
              ? { ...message, readAt }
              : message),
          }))
        })
        connection.on('presence:update', ({ userId, online, lastSeenAt }) => {
          setConversations((current) => current.map((item) => ({
            ...item,
            members: item.members?.map((member) => member.id === userId ? { ...member, online, lastSeenAt } : member),
            ...(item.profileId === userId ? { online, lastSeenAt } : {}),
          })))
        })
        connection.on('realtime:error', ({ message }) => setMessagingError(message))
      })
      .catch((error) => {
        if (active) {
          setConnectionState('reconnecting')
          setMessagingError(error.message || 'Realtime messaging could not connect.')
        }
      })
    return () => {
      active = false
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current)
      socket?.disconnect()
      socketRef.current = null
    }
  }, [currentUser.id, reloadConversations, usesApi])

  useEffect(() => {
    if (!usesApi) return undefined
    if (!selectedId || connectionState !== 'connected') return
    const socket = socketRef.current
    if (!socket) return
    socket.emit('conversation:join', { conversationId: selectedId }, (result) => {
      if (result?.error) {
        setMessagingError(result.error.message)
        return
      }
      socket.emit('conversation:read', { conversationId: selectedId }, (readResult) => {
        if (readResult?.error) setMessagingError(readResult.error.message)
      })
    })
    const controller = new AbortController()
    getMessages(selectedId, { signal: controller.signal })
      .then(({ messages: conversationMessages }) => {
        setMessages((current) => ({ ...current, [selectedId]: conversationMessages }))
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setMessagingError(error.message || 'Message history could not load.')
      })
    return () => controller.abort()
  }, [selectedId, connectionState, usesApi])

  useEffect(() => {
    onMobileChatChange(conversationOpen && Boolean(selectedConversation))
  }, [conversationOpen, onMobileChatChange, selectedConversation])

  useEffect(() => {
    if (!openProfile?.id || openProfile.id === currentUser.id) return
    if (openProfile.initialMessage) setPendingStoryReply(openProfile.initialMessage)
    if (!usesApi) {
      const existing = conversationsRef.current.find((item) => item.profileId === openProfile.id)
      const conversation = existing || {
        id: `local-${openProfile.id}`,
        profileId: openProfile.id,
        name: openProfile.name,
        handle: `@${openProfile.username || openProfile.id}`,
        initials: openProfile.initials || getAvatarInitial(openProfile),
        profilePicture: openProfile.profilePicture || null,
        tone: openProfile.tone || 'amber',
        online: false,
        time: 'Just now',
        unread: 0,
        messages: [],
      }
      if (!existing) {
        setConversations((current) => [conversation, ...current])
        setMessages((current) => ({ ...current, [conversation.id]: [] }))
      }
      setSelectedId(conversation.id)
      setConversationOpen(true)
      return undefined
    }
    let active = true
    createConversation([openProfile.id])
      .then(({ conversation }) => reloadConversations().then(() => {
        if (!active) return
        setSelectedId(conversation.id)
        setConversationOpen(true)
      }))
      .catch((error) => {
        if (active) setMessagingError(error.message || 'A conversation could not be started.')
      })
    return () => { active = false }
  }, [currentUser.id, openProfile, reloadConversations, usesApi])

  useEffect(() => {
    if (!noteEditorOpen && !noteViewer) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setNoteEditorOpen(false)
        setNoteViewer(null)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [noteEditorOpen, noteViewer])

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return conversations
    return conversations.filter((conversation) => [
      conversation.name,
      conversation.handle,
      ...(conversation.messages || []).map((message) => message.text),
      ...(messages[conversation.id] || []).map((message) => message.text),
    ].some((value) => value.toLowerCase().includes(normalizedQuery)))
  }, [conversations, messages, query])

  function selectConversation(id, openChat = true) {
    setSelectedId(id)
    setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, unread: 0 } : conversation))
    if (openChat) setConversationOpen(true)
  }

  async function createGroup(participantIds, groupName, groupPicture) {
    if (!usesApi) {
      throw new Error('Sign in to create a group with your followers.')
    }
    const { conversation } = await createConversation(participantIds, {
      groupName,
      ...(groupPicture ? { groupPicture } : {}),
    })
    setGroupDialogOpen(false)
    setMessagingError('')
    try {
      const updated = await reloadConversations()
      if (updated.some((item) => item.id === conversation.id)) {
        selectConversation(conversation.id)
      } else {
        setMessagingError('The group was created, but it is not available in your conversation list yet. Refresh Messages to open it.')
      }
    } catch (error) {
      setMessagingError(error.message || 'The group was created, but the conversation list could not be refreshed.')
    }
  }

  async function addPeopleToGroup(conversationId, participantIds) {
    if (!usesApi) throw new Error('Sign in to add people to a group.')
    await addGroupMembersApi(conversationId, participantIds)
    await reloadConversations()
  }

  async function leaveGroupConversation(conversationId) {
    if (!usesApi) throw new Error('Sign in to leave this group.')
    await leaveGroupApi(conversationId)
    socketRef.current?.emit('conversation:leave', { conversationId })
    const updated = await reloadConversations()
    setConversationOpen(false)
    setSelectedId(updated[0]?.id || null)
  }

  function sendMessage(conversationId, text, _replyTo, image = null, contextLabel = null) {
    const conversation = conversations.find((item) => item.id === conversationId)
    if (!usesApi) {
      if (!conversation || conversation.blocked) return Promise.resolve(false)
      const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date())
      const message = { id: `local-message-${Date.now()}`, from: 'me', text, contextLabel: contextLabel === 'story_reply' ? 'You replied to their story' : contextLabel, time, imageUrl: image?.url ?? null }
      setMessages((current) => ({
        ...current,
        [conversationId]: [...(current[conversationId] || conversation.messages || []), message],
      }))
      setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, time, unread: 0 } : item))
      setMessagingError('')
      return Promise.resolve(true)
    }
    const socket = socketRef.current
    if (!conversation || conversation.blocked) return Promise.resolve(false)
    if (!socket?.connected) {
      setMessagingError('Reconnect before sending your message.')
      return Promise.resolve(false)
    }
    setMessagingError('')
    return new Promise((resolve) => {
      socket.emit('message:send', { conversationId, content: text, contextLabel, ...(image ? { image } : {}) }, (result) => {
        if (result?.error) {
          setMessagingError(result.error.message || 'Your message could not be sent.')
          resolve(false)
          return
        }
        resolve(true)
      })
    })
  }

  async function sendVoiceNote(conversationId, blob) {
    if (!usesApi) throw new Error('Sign in to send a voice note.')
    const message = await uploadVoiceNote(conversationId, blob)
    const mapped = {
      ...message,
      from: 'me',
      text: message.text ?? 'Voice note',
    }
    setMessages((current) => {
      const existing = current[conversationId] || []
      if (existing.some((item) => item.id === mapped.id)) return current
      return { ...current, [conversationId]: [...existing, mapped] }
    })
    return true
  }

  async function refreshVoiceNote(conversationId, messageId) {
    const { url } = await refreshVoiceNoteUrl(conversationId, messageId)
    return url
  }

  function changeTyping(conversationId, typing) {
    if (!usesApi) return
    const socket = socketRef.current
    if (!socket?.connected) return
    socket.emit('conversation:typing', { conversationId, typing })
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current)
    if (typing) {
      typingTimerRef.current = window.setTimeout(() => {
        socket.emit('conversation:typing', { conversationId, typing: false })
      }, 1500)
    }
  }

  function toggleReaction(messageId) {
    setReactions((current) => ({ ...current, [messageId]: !current[messageId] }))
  }

  function deleteMessageForEveryone(conversationId, messageId) {
    if (!usesApi) {
      removeDeletedMessage(conversationId, messageId)
      return
    }
    const socket = socketRef.current
    if (!socket?.connected) {
      setMessagingError('Reconnect before deleting this message for everyone.')
      return
    }
    socket.emit('message:delete', { conversationId, messageId }, (result) => {
      if (result?.error) {
        setMessagingError(result.error.message || 'The message could not be deleted for everyone.')
        return
      }
      removeDeletedMessage(conversationId, messageId)
    })
  }

  function forwardMessage(targetId, original) {
    const target = conversations.find((item) => item.id === targetId)
    if (!target || target.blocked) return
    if (!usesApi) {
      const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date())
      const message = { id: `local-message-${Date.now()}`, from: 'me', text: original.unsent ? 'Message unsent' : original.text, time, forwarded: true }
      setMessages((current) => ({ ...current, [targetId]: [...(current[targetId] || target.messages || []), message] }))
      setConversations((current) => current.map((item) => item.id === targetId ? { ...item, time } : item))
      selectConversation(targetId, false)
      return
    }
    const socket = socketRef.current
    if (!socket?.connected) {
      setMessagingError('Reconnect before forwarding this message.')
      return
    }
    socket.emit('message:send', { conversationId: targetId, content: original.unsent ? 'Message unsent' : original.text }, (result) => {
      if (result?.error) setMessagingError(result.error.message || 'The message could not be forwarded.')
    })
    selectConversation(targetId, false)
  }

  async function setNickname(conversation, nickname) {
    const conversationId = conversation.id
    if (usesApi && conversation.profileId) {
      const { nickname: savedNickname } = await setConversationNickname(conversationId, nickname)
      setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, nickname: savedNickname } : item))
      return
    }
    setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, nickname } : item))
  }

  async function toggleMuted(conversationId, muted) {
    const previous = conversations.find((item) => item.id === conversationId)?.muted ?? false
    setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, muted } : item))
    if (!usesApi) return
    try {
      await setConversationMuted(conversationId, muted)
    } catch (error) {
      setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, muted: previous } : item))
      setMessagingError(error.message || 'The conversation mute setting could not be saved.')
    }
  }

  async function reportConversationAccount(userId, report) {
    if (!usesApi) throw new Error('Sign in to report an account.')
    await reportUser(userId, report)
  }

  function toggleBlocked(conversationId) {
    setConversations((current) => current.map((conversation) => conversation.id === conversationId
      ? { ...conversation, blocked: !conversation.blocked }
      : conversation))
    setMessagingError('')
  }

  function replyToNote(note) {
    setNoteViewer(null)
    if (!usesApi) {
      const id = note.userId || note.profileId || note.id
      const existing = conversations.find((item) => item.profileId === id)
      const conversation = existing || {
        id: `local-${id}`,
        profileId: id,
        name: note.name,
        handle: note.handle || `@${note.username || id}`,
        initials: note.initials,
        tone: note.tone,
        online: Boolean(note.online),
        time: 'Just now',
        unread: 0,
        messages: [],
      }
      if (!existing) {
        setConversations((current) => [conversation, ...current])
        setMessages((current) => ({ ...current, [conversation.id]: [] }))
      }
      selectConversation(conversation.id)
      window.setTimeout(() => composerRef.current?.focus(), 120)
      return
    }
    createConversation([note.userId || note.id])
      .then(({ conversation }) => reloadConversations().then(() => selectConversation(conversation.id)))
      .catch((error) => setMessagingError(error.message || 'A conversation could not be started.'))
    window.setTimeout(() => composerRef.current?.focus(), 120)
  }

  async function submitNote(note) {
    if (!usesApi) {
      setOwnNote({
        id: 'morgan-note',
        profileId: currentUser.id,
        userId: currentUser.id,
        name: currentUser.name,
        username: currentUser.username,
        handle: `@${currentUser.username}`,
        initials: currentUser.initials || getAvatarInitial(currentUser),
        tone: currentUser.tone || 'amber',
        text: note.text,
        audience: note.audience,
        own: true,
        timeRemaining: '24h left',
      })
      return
    }
    const { note: saved } = await saveNote({
      content: note.text,
      audience: note.audience === 'Close friends' ? 'close-friends' : 'followers',
    })
    const mappedNote = {
      ...saved.user,
      id: saved.id,
      userId: saved.user.id,
      noteId: saved.id,
      text: saved.content,
      audience: saved.audience,
      own: true,
      timeRemaining: '24h left',
    }
    setOwnNote(mappedNote)
  }

  async function removeOwnNote() {
    if (!usesApi) {
      setOwnNote(null)
      return
    }
    await deleteNote()
    setOwnNote(null)
  }

  return (
    <div className={`messages-page${conversationOpen && selectedConversation ? ' is-chat-open' : ''}`}>
      <header className="messages-page__heading">
        <div className="messages-page__title-row">
          <h1>Messages</h1>
        </div>
      </header>
      {messagingError && <p className="messages-blocked-notice" role="alert">{messagingError}</p>}

      <NotesStrip
        ownNote={ownNote}
        notes={notes}
        currentUser={currentUser}
        onAdd={() => setNoteEditorOpen(true)}
        onEdit={() => setNoteEditorOpen(true)}
        onView={openNoteViewer}
      />

      <div className="messages-search-row">
        <label className="messages-search">
          <Icon name="search" size={18} />
          <span className="visually-hidden">Search messages</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages" autoComplete="off" />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}
        </label>
        <button className="messages-create-group" type="button" aria-label="Create a group conversation" title="Create a group conversation" onClick={() => setGroupDialogOpen(true)}><Icon name="add" size={17} /></button>
      </div>

      <div className={`messages-layout${conversationOpen && selectedConversation ? ' is-chat-open' : ''}`}>
        <section className="messages-list-panel" aria-label="Conversations">
          <div className="messages-list-panel__heading">
            <h2>Conversations</h2>
            <span>{filteredConversations.length}</span>
          </div>
          {loadingConversations
            ? <p className="messages-search-empty" role="status">Loading conversations…</p>
            : <ConversationList conversations={filteredConversations} messages={messages} selectedId={selectedId} onSelect={selectConversation} onViewProfile={onViewProfile} query={query} />}
        </section>
        <div className="messages-chat-panel">
          {selectedConversation
            ? <ChatPanel conversation={selectedConversation} conversations={conversations} messages={messages} reactions={reactions} onSend={sendMessage} onSendVoiceNote={sendVoiceNote} onRefreshVoiceNote={refreshVoiceNote} onStartCall={callManager?.startCall || onStartCall} callActive={Boolean(callManager?.call) || callActive} onReact={toggleReaction} onDeleteForEveryone={deleteMessageForEveryone} onForward={forwardMessage} onNickname={setNickname} onBlock={toggleBlocked} onMute={toggleMuted} onReport={reportConversationAccount} onAddGroupMembers={addPeopleToGroup} onLeaveGroup={leaveGroupConversation} userId={currentUser.id} composerRef={composerRef} onBack={() => setConversationOpen(false)} onViewProfile={onViewProfile} onTypingChange={changeTyping} isTyping={Boolean(typingByConversation[selectedConversation.id])} connectionState={connectionState} initialDraft={selectedConversation.profileId === openProfile?.id ? pendingStoryReply : null} onInitialDraftUsed={() => setPendingStoryReply(null)} />
            : <EmptyChat />}
        </div>
        <aside className="messages-details" aria-label="Conversation details">
          {selectedConversation ? (
            <div className="messages-details__profile">
              <PersonAvatar person={selectedConversation} className="messages-details__avatar" onClick={selectedConversation.profileId ? () => onViewProfile(selectedConversation.profileId) : undefined} />
              <strong>{selectedConversation.name}</strong>
              <span>{selectedConversation.handle}</span>
              <small><i className={selectedConversation.online ? 'is-online' : ''} />{selectedConversation.online ? 'Online' : 'Away'}</small>
              {selectedConversation.groupName && <div className="messages-details__members"><strong>Members</strong>{selectedConversation.members.map((member) => <button type="button" key={member.id} onClick={() => onViewProfile(member.username)}><PersonAvatar person={member} /><span>{member.name}</span></button>)}</div>}
            </div>
          ) : <span className="messages-details__empty">Choose someone to see more.</span>}
        </aside>
      </div>

      {noteEditorOpen && (
        <NoteEditor
          initialNote={ownNote}
          onClose={() => setNoteEditorOpen(false)}
          onSave={async (note) => {
            try {
              await submitNote(note)
              setNoteEditorOpen(false)
              setMessagingError('')
            } catch (error) {
              setMessagingError(error.message || 'Your note could not be saved.')
            }
          }}
          onRemove={async () => {
            try {
              await removeOwnNote()
              setNoteEditorOpen(false)
            } catch (error) {
              setMessagingError(error.message || 'Your note could not be removed.')
            }
          }}
        />
      )}
      {noteViewer && <NoteViewer note={noteViewer} onClose={() => setNoteViewer(null)} onReply={() => replyToNote(noteViewer)} />}
      {groupDialogOpen && <GroupCreateDialog username={currentUser.username} localMode={!usesApi} onClose={() => setGroupDialogOpen(false)} onCreate={createGroup} />}
    </div>
  )
}
