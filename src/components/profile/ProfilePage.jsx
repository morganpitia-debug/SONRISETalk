import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import ProfilePhotoButton from '../ProfilePhotoButton.jsx'
import ProfileHighlights from './ProfileHighlights.jsx'
import { getProfile, getProfileConnections, reportUser, updateProfile, uploadMedia } from '../../api/social.js'
import { isApiEnabled } from '../../api/auth.js'

function mapProfile(profile) {
  const content = (profile.posts || []).map((post) => ({
    ...post,
    media: post.media || post.mediaItems?.[0]?.url || '',
    mediaType: post.mediaType || post.mediaItems?.[0]?.type || post.type || 'image',
    title: post.title || post.body || '',
    caption: post.body || post.title || '',
    views: 0,
    tone: 'amber',
    symbol: '',
  }))
  return {
    ...profile,
    photo: profile.profilePicture || null,
    tone: 'amber',
    posts: content.filter((post) => post.format !== 'Reel' && post.type !== 'reel'),
    reels: content.filter((post) => post.format === 'Reel' || post.type === 'reel' || (post.format == null && post.type === 'video')),
  }
}

function useObjectUrl(file) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!file) {
      setUrl('')
      return undefined
    }
    if (!(file instanceof Blob)) {
      setUrl(typeof file === 'string' ? file : '')
      return undefined
    }

    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  return url
}

function ProfileAvatar({ profile, className = '' }) {
  const hasPhoto = Boolean(profile.photo)
  const [imageFailed, setImageFailed] = useState(false)
  const showPhoto = hasPhoto && !imageFailed
  return (
    <span className={`profile-avatar${showPhoto ? ' has-photo' : ''} profile-avatar--${profile.tone || 'amber'} ${className}`.trim()} aria-hidden="true">
      {showPhoto && <img src={profile.photo} alt="" onError={() => setImageFailed(true)} />}
      {!showPhoto && <span>{profile.initials || '?'}</span>}
    </span>
  )
}

function ConnectionsDialog({ type, profile, onClose, onViewProfile }) {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const title = type === 'followers' ? 'Followers' : 'Following'

  useEffect(() => {
    if (!isApiEnabled()) {
      setPeople([])
      setLoading(false)
      return undefined
    }
    let active = true
    getProfileConnections(profile.username, type)
      .then(({ users }) => {
        if (active) setPeople(users.map((person) => ({ ...person, photo: person.profilePicture, tone: 'amber' })))
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || `${title} could not load.`)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [profile.username, title, type])

  return createPortal(
    <div className="profile-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="profile-modal profile-connections" role="dialog" aria-modal="true" aria-labelledby="profile-connections-title">
        <div className="profile-modal__heading">
          <div><span className="profile-eyebrow">@{profile.username}</span><h2 id="profile-connections-title">{title}</h2></div>
          <button type="button" className="profile-icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        {loading ? <p className="profile-connections__empty" role="status">Loading {title.toLowerCase()}…</p> : error ? <p className="profile-connections__empty" role="alert">{error}</p> : people.length ? (
          <div className="profile-connections__list">
            {people.map((person) => (
              <button className="profile-connection" type="button" key={person.id} onClick={() => { onClose(); onViewProfile(person.username) }}>
                <ProfileAvatar profile={person} className="profile-avatar--connection" />
                <span><strong>{person.name}</strong><small>@{person.username}</small></span>
                <Icon name="arrow" size={15} />
              </button>
            ))}
          </div>
        ) : <p className="profile-connections__empty">No {title.toLowerCase()} to show yet.</p>}
      </section>
    </div>,
    document.body,
  )
}

function EditProfileDialog({ profile, onCancel, onSave }) {
  const [draft, setDraft] = useState(profile)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const photoUrl = useObjectUrl(draft.photo)

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setSaveError('')
    setSaving(true)
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        username: draft.username.trim().replace(/^@+/, ''),
        bio: draft.bio.trim(),
      })
    } catch (error) {
      setSaveError(error.message || 'Your profile could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="profile-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">
        <div className="profile-modal__heading">
          <h2 id="profile-edit-title">Edit profile</h2>
          <button type="button" className="profile-icon-button" aria-label="Close edit profile" onClick={onCancel}><Icon name="close" size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <div className="profile-edit-photo">
            <ProfileAvatar profile={{ photo: photoUrl }} className="profile-avatar--edit" />
            <div className="profile-edit-photo__copy"><strong>Profile photo</strong><small>Choose an image from this device. It stays local.</small></div>
            <label className="profile-secondary-button" htmlFor="profile-photo">Change</label>
            <input id="profile-photo" type="file" accept="image/*" onChange={(event) => update('photo', event.target.files?.[0] || null)} />
          </div>
          <label className="profile-field">Name
            <input autoFocus required maxLength={60} value={draft.name} onChange={(event) => update('name', event.target.value)} />
          </label>
          <label className="profile-field">Username
            <span className="profile-field__username"><span>@</span><input required maxLength={30} pattern="[A-Za-z0-9._]+" value={draft.username} onChange={(event) => update('username', event.target.value.replace(/^@+/, ''))} /></span>
          </label>
          <label className="profile-field">Bio
            <textarea maxLength={160} rows={3} value={draft.bio} onChange={(event) => update('bio', event.target.value)} />
            <small className="profile-field__count">{draft.bio.length}/160</small>
          </label>
          {saveError && <p className="profile-field__error" role="alert">{saveError}</p>}
          <div className="profile-modal__actions">
            <button className="profile-secondary-button" type="button" onClick={onCancel}>Cancel</button>
            <button className="profile-primary-button" type="submit" disabled={saving || !draft.name.trim() || !draft.username.trim()}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

function ReportAccountDialog({ profile, onClose, onSubmit }) {
  const [reason, setReason] = useState('spam')
  const [details, setDetails] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onSubmit({ reason, details: details.trim() })
      onClose()
    } catch (requestError) {
      setError(requestError.message || 'The report could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div className="profile-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-report-title">
        <div className="profile-modal__heading">
          <div><span className="profile-eyebrow">@{profile.username}</span><h2 id="profile-report-title">Report account</h2></div>
          <button type="button" className="profile-icon-button" aria-label="Close report dialog" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <label className="profile-field">Why are you reporting this account?
            <select value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="spam">Spam or scam</option>
              <option value="harassment">Harassment or bullying</option>
              <option value="impersonation">Impersonation</option>
              <option value="inappropriate">Inappropriate content</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label className="profile-field">Details (optional)
            <textarea value={details} maxLength={1000} rows={4} onChange={(event) => setDetails(event.target.value)} placeholder="Share details that could help review this report." />
            <small className="profile-field__count">{details.length}/1000</small>
          </label>
          <p className="settings-section-intro">Reports are private and reviewed by authorized admins. Please report honestly.</p>
          {error && <p className="profile-field__error" role="alert">{error}</p>}
          <div className="profile-modal__actions">
            <button className="profile-secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="profile-primary-button" type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit report'}</button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

function ContentArtwork({ item, className = '' }) {
  const [mediaFailed, setMediaFailed] = useState(false)
  const media = typeof item.media === 'string'
    ? item.media
    : item.media?.url || item.mediaItems?.[0]?.url || ''
  const mediaType = item.mediaType || item.mediaItems?.[0]?.type || item.type
  const hasMedia = Boolean(media && !mediaFailed)

  useEffect(() => {
    setMediaFailed(false)
  }, [media])

  return (
    <span className={`profile-art profile-art--${item.tone}${hasMedia ? ' profile-art--media' : ''} ${className}`.trim()} aria-hidden={className ? undefined : 'true'}>
      {hasMedia ? mediaType === 'video' || mediaType === 'reel' ? (
        <video
          className="profile-art__media"
          src={media}
          muted
          playsInline
          preload="metadata"
          autoPlay={!className}
          loop={!className}
          controls={Boolean(className)}
          onError={() => setMediaFailed(true)}
        />
      ) : (
        <img className="profile-art__media" src={media} alt="" onError={() => setMediaFailed(true)} />
      ) : (
        <>
          <span className="profile-art__orb" />
          {item.symbol && <span className="profile-art__symbol">{item.symbol}</span>}
          <span className="profile-art__horizon" />
        </>
      )}
    </span>
  )
}

function ContentViewer({ item, reel, profile, onClose }) {
  const title = item.title
  return createPortal(
    <div className="profile-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`profile-viewer${reel ? ' profile-viewer--reel' : ''}`} role="dialog" aria-modal="true" aria-label={`${reel ? 'Reel' : 'Post'}: ${title}`}>
        <button type="button" className="profile-icon-button profile-viewer__close" aria-label="Close viewer" onClick={onClose}><Icon name="close" size={18} /></button>
        <ContentArtwork item={item} className="profile-viewer__art" />
        <div className="profile-viewer__copy">
          {reel && <span className="profile-eyebrow">REEL</span>}
          <h2>{title}</h2>
          {!reel && <p>{item.caption}</p>}
          <span className="profile-viewer__author">{profile.name} <i /> @{profile.username}</span>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default function ProfilePage({ profile, onProfileChange, viewedProfile = null, onViewProfile, followedProfileIds = [], followRequestsSentIds = [], confirmedFollowerIds = [], onToggleFollow, onMessageProfile, openEdit = false, onEditOpened }) {
  const [activeTab, setActiveTab] = useState('Posts')
  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeItem, setActiveItem] = useState(null)
  const [connectionsType, setConnectionsType] = useState(null)
  const [reportingAccount, setReportingAccount] = useState(false)
  const [notice, setNotice] = useState('')
  const [apiProfileState, setApiProfileState] = useState({ key: null, profile: null })
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const usesApi = isApiEnabled()
  const menuRef = useRef(null)
  const isOwnProfile = !viewedProfile
  const profileKey = isOwnProfile ? profile.username : viewedProfile.username || viewedProfile.id
  const apiProfile = apiProfileState.key === profileKey ? apiProfileState.profile : null
  const displayedProfile = apiProfile || viewedProfile || profile
  const avatarUrl = useObjectUrl(isOwnProfile ? profile.photo : null)
  const profileForDisplay = { ...displayedProfile, photo: isOwnProfile ? avatarUrl || displayedProfile.photo || null : displayedProfile.photo || null }
  const isFollowed = Boolean(viewedProfile && followedProfileIds.includes(displayedProfile.id))
  const followRequested = Boolean(viewedProfile && (displayedProfile.requested || followRequestsSentIds.includes(displayedProfile.id)))
  const canMessage = Boolean(viewedProfile && (isFollowed || confirmedFollowerIds.includes(displayedProfile.id)))
  const isPrivateLocked = Boolean(!isOwnProfile && displayedProfile.isPrivate && !isFollowed)
  const profilePosts = displayedProfile.posts || []
  const profileReels = displayedProfile.reels || []
  const profileTagged = []
  const selectedItems = activeTab === 'Posts' ? profilePosts : activeTab === 'Reels' ? profileReels : profileTagged
  const followerCount = Number.isFinite(displayedProfile.followerCount) ? displayedProfile.followerCount : 0
  const profileFollowingCount = Number.isFinite(displayedProfile.followingCount) ? displayedProfile.followingCount : 0
  const followingCount = isOwnProfile ? profileFollowingCount : profileFollowingCount + (isFollowed ? 1 : 0)

  useEffect(() => {
    if (!usesApi || !profileKey) {
      setApiProfileState({ key: profileKey, profile: null })
      setProfileLoading(false)
      setProfileError('')
      return undefined
    }
    let active = true
    setApiProfileState({ key: profileKey, profile: null })
    setProfileLoading(true)
    setProfileError('')
    getProfile(profileKey)
      .then(({ profile: result }) => {
        if (!active) return
        const mapped = mapProfile(result)
        setApiProfileState({ key: profileKey, profile: mapped })
        if (isOwnProfile) onProfileChange(mapped)
      })
      .catch((error) => {
        if (active) setProfileError(error.message || 'This profile could not load.')
      })
      .finally(() => {
        if (active) setProfileLoading(false)
      })
    return () => { active = false }
  }, [isOwnProfile, onProfileChange, profileKey, usesApi])

  useEffect(() => {
    if (!openEdit || viewedProfile) return
    setEditing(true)
    onEditOpened?.()
  }, [openEdit, viewedProfile, onEditOpened])

  useEffect(() => {
    if (!menuOpen) return undefined
    function closeMenu(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [menuOpen])

  useEffect(() => {
    if (!editing && !activeItem && !connectionsType) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setEditing(false)
        setActiveItem(null)
        setConnectionsType(null)
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [editing, activeItem, connectionsType])

  async function saveProfile(nextProfile) {
    const uploadedPhoto = usesApi && nextProfile.photo instanceof Blob
      ? await uploadMedia(nextProfile.photo)
      : null
    let photo = uploadedPhoto?.url ?? (typeof nextProfile.photo === 'string' ? nextProfile.photo : null)

    if (usesApi) {
      const savedProfile = await updateProfile({
        name: nextProfile.name,
        username: nextProfile.username,
        bio: nextProfile.bio,
        profilePicture: uploadedPhoto
          ? {
              url: uploadedPhoto.url,
              assetId: uploadedPhoto.assetId,
              mediaType: uploadedPhoto.resourceType,
              contentType: uploadedPhoto.mimeType,
            }
          : nextProfile.photo === null ? null : undefined,
      })
      photo = savedProfile.profilePicture
    }

    const updatedProfile = { ...(apiProfile || profile), ...nextProfile, photo }
    if (usesApi) setApiProfileState({ key: profileKey, profile: updatedProfile })
    onProfileChange(updatedProfile)
    setEditing(false)
    setNotice('Profile updated.')
  }

  async function copyProfileLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setNotice('Preview link copied.')
    } catch {
      setNotice('Clipboard access is unavailable in this preview.')
    }
    setMenuOpen(false)
  }

  async function shareProfile() {
    setMenuOpen(false)
    try {
      if (navigator.share) {
        await navigator.share({ title: `${displayedProfile.name} on SONRISETALK`, text: `Connect with @${displayedProfile.username} on SONRISETALK.`, url: window.location.href })
      } else {
        await navigator.clipboard.writeText(window.location.href)
      }
      setNotice('Profile ready to share.')
    } catch (error) {
      if (error.name !== 'AbortError') setNotice('Sharing is unavailable in this preview.')
    }
  }

  function openConnections(type) {
    setMenuOpen(false)
    setConnectionsType(type)
  }

  function updateHighlights(highlights) {
    const updatedProfile = { ...displayedProfile, highlights }
    setApiProfileState({ key: profileKey, profile: updatedProfile })
    if (isOwnProfile) onProfileChange(updatedProfile)
  }

  return (
    <div className="profile-page">
      <header className="profile-page__intro">
        <h1>Profile</h1>
      </header>

      <section className={`profile-summary${isOwnProfile ? '' : ' profile-summary--public'}`} aria-label="Profile information">
        <ProfilePhotoButton className="profile-photo-button--profile" person={viewedProfile || { name: profile.name, own: true }} onViewProfile={onViewProfile}>
          <ProfileAvatar profile={profileForDisplay} className="profile-avatar--large" />
        </ProfilePhotoButton>
        <div className="profile-identity">
          <h2>{displayedProfile.name}</h2>
          <span className="profile-username">@{displayedProfile.username}</span>
          <p>{displayedProfile.bio}</p>
          <div className="profile-stats" aria-label="Profile stats">
            <span><strong>{Number.isFinite(displayedProfile.postCount) ? displayedProfile.postCount : profilePosts.length}</strong> Posts</span>
            <button type="button" onClick={() => openConnections('followers')} aria-label={`${followerCount} followers`}>
              <strong>{followerCount}</strong> Followers
            </button>
            <button type="button" onClick={() => openConnections('following')} aria-label={`${followingCount} following`}>
              <strong>{followingCount}</strong> Following
            </button>
          </div>
          <div className="profile-actions">
            {isOwnProfile ? (
              <>
                <button className="profile-primary-button" type="button" onClick={() => { setNotice(''); setEditing(true) }}>Edit profile</button>
                <button className="profile-secondary-button profile-share-button" type="button" onClick={shareProfile}>Share profile</button>
              </>
            ) : (
              <>
                <button className={`profile-follow-button${isFollowed || followRequested ? ' is-following' : ''}`} type="button" aria-pressed={isFollowed || followRequested} onClick={() => onToggleFollow?.(displayedProfile)}>
                  {isFollowed ? 'Following' : followRequested ? 'Request sent' : 'Follow'}
                </button>
                {canMessage && <button className="profile-secondary-button" type="button" onClick={() => onMessageProfile?.(displayedProfile)}>Message</button>}
                <button className="profile-secondary-button" type="button" onClick={() => onViewProfile?.(null)}>Back to my profile</button>
              </>
            )}
          </div>
        </div>
        <div className={`profile-menu-wrap${isOwnProfile ? '' : ' profile-menu-wrap--public'}`} ref={menuRef}>
          <button type="button" className="profile-icon-button profile-menu-toggle" aria-label="Profile options" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name="more" size={19} /></button>
          {menuOpen && (
            <div className="profile-menu" role="menu" aria-label="Profile options">
              {isOwnProfile ? <>
                <button type="button" role="menuitem" onClick={shareProfile}>Share profile</button>
                <button type="button" role="menuitem" onClick={copyProfileLink}>Copy profile link</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setNotice('Profile settings are a local preview.') }}>Settings</button>
              </> : displayedProfile.id && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setReportingAccount(true) }}>Report account</button>}
            </div>
          )}
        </div>
      </section>

      {profileError && <p className="stream-error" role="alert">{profileError}</p>}
      {profileLoading && <p className="profile-empty" role="status">Loading profile…</p>}
      {!profileLoading && !profileError && isPrivateLocked ? (
        <section className="profile-private-state" role="status">
          <Icon name="privacy" size={21} />
          <h2>This account is private.</h2>
          <p>Follow this account to see their posts, Reels, and tagged photos.</p>
          {followRequested && <small>Your follow request is waiting for approval.</small>}
        </section>
      ) : !profileLoading && !profileError && <div className="profile-content">
        <ProfileHighlights profile={displayedProfile} isOwner={isOwnProfile} usesApi={usesApi} onHighlightsChange={updateHighlights} />
        <div className="profile-tabs" role="tablist" aria-label="Profile content">
          {['Posts', 'Reels', 'Tagged'].map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} aria-controls="profile-tab-panel" className={activeTab === tab ? 'is-active' : ''} onClick={() => setActiveTab(tab)}>
              {tab}<span>{tab === 'Posts' ? profilePosts.length : tab === 'Reels' ? profileReels.length : profileTagged.length}</span>
            </button>
          ))}
        </div>
        <section id="profile-tab-panel" className={`profile-grid${activeTab === 'Reels' ? ' profile-grid--reels' : ''}`} role="tabpanel" aria-label={`${activeTab} by ${displayedProfile.name}`}>
          {selectedItems.length ? selectedItems.map((item) => (
            <button className={`profile-tile${activeTab === 'Reels' ? ' profile-tile--reel' : ''}`} type="button" key={item.id} aria-label={`${activeTab === 'Reels' ? 'Open reel' : 'Open post'}: ${item.title}`} onClick={() => setActiveItem({ ...item, reel: activeTab === 'Reels' })}>
              <ContentArtwork item={item} />
              {activeTab === 'Reels' ? <><span className="profile-tile__play"><Icon name="play" size={15} /></span><span className="profile-tile__views">Reel</span></> : <span className="profile-tile__caption">{item.title}</span>}
            </button>
          )) : <p className="profile-empty">{activeTab === 'Tagged' ? 'No tagged posts yet.' : `No ${activeTab.toLowerCase()} yet.`}</p>}
        </section>
      </div>}

      {notice && <div className="profile-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><Icon name="close" size={15} /></button></div>}
      {connectionsType && <ConnectionsDialog type={connectionsType} profile={displayedProfile} onClose={() => setConnectionsType(null)} onViewProfile={onViewProfile} />}
      {editing && isOwnProfile && <EditProfileDialog profile={profile} onCancel={() => setEditing(false)} onSave={saveProfile} />}
      {reportingAccount && viewedProfile && <ReportAccountDialog profile={displayedProfile} onClose={() => setReportingAccount(false)} onSubmit={(report) => reportUser(displayedProfile.id, report).then(() => setNotice('Thank you. Your report was submitted for review.'))} />}
      {activeItem && <ContentViewer item={activeItem} reel={activeItem.reel} profile={displayedProfile} onClose={() => setActiveItem(null)} />}
    </div>
  )
}
