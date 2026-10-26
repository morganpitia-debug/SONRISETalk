import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import ProfilePhotoButton from '../ProfilePhotoButton.jsx'
import UserAvatar from '../UserAvatar.jsx'

const typeIcons = {
  LIKE: 'heart',
  COMMENT: 'messages',
  MESSAGE: 'messages',
  FOLLOW: 'add',
  MENTION: 'profile',
  'STORY REPLY': 'story',
  'REEL ACTIVITY': 'play',
}

function NotificationViewer({ notification, onClose }) {
  const isStory = notification.target === 'story'
  return (
    <div className="notification-viewer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="notification-viewer" role="dialog" aria-modal="true" aria-label={isStory ? 'Story reply' : `${notification.type.toLowerCase()} preview`}>
        <button className="notification-viewer__close" type="button" aria-label="Close notification preview" onClick={onClose}><Icon name="close" size={18} /></button>
        <span className={`notification-viewer__art notification-viewer__art--${notification.thumbnail || 'amber'}`}>
          <span>{isStory ? 'YOUR STORY' : notification.target === 'reel' ? <Icon name="play" size={22} /> : notification.type}</span>
        </span>
        <div className="notification-viewer__copy">
          <span className="notification-eyebrow">{isStory ? 'STORY REPLY' : notification.target === 'reel' ? 'REEL' : 'POST'}</span>
          <h2>{isStory ? 'A reply to your story' : notification.title}</h2>
          {notification.quote && <blockquote>{notification.quote}</blockquote>}
          {notification.detail && <p>{notification.detail}</p>}
          <span className="notification-viewer__person">{notification.person} · {notification.time}</span>
        </div>
      </section>
    </div>
  )
}

function NotificationItem({ notification, onOpen, onResolveFollow, onFollowBack, onMessageProfile, onViewProfile, isPrivateAccount, isFollowingBack }) {
  const action = notification.type === 'FOLLOW' && (
    notification.followStatus === 'accepted' ||
    (notification.followStatus === 'pending' && !isPrivateAccount)
  ) ? 'started following you' : notification.action
  const openMessage = () => onMessageProfile?.({
    id: notification.profileId,
    name: notification.person,
    username: notification.username || notification.profileId,
    initials: notification.initials,
    tone: notification.tone,
  })
  return (
    <div className="notification-entry">
      <div className={`notification-item${notification.read ? '' : ' is-unread'}`}>
        <ProfilePhotoButton className="notification-item__profile" person={{ name: notification.person, username: notification.username, profileId: notification.profileId, initials: notification.initials, tone: notification.tone }} onViewProfile={onViewProfile}>
          <UserAvatar person={notification} className={`avatar--${notification.tone} notification-item__avatar`} />
        </ProfilePhotoButton>
        <button className="notification-item__content" type="button" onClick={() => onOpen(notification)} aria-label={`${notification.person} ${action}, ${notification.time}${notification.read ? '' : ', unread'}`}>
          <span className="notification-item__body">
            <span className="notification-item__text"><strong>{notification.person}</strong> {action}{notification.quote && <span className="notification-item__quote">{notification.quote}</span>}</span>
            <span className="notification-item__meta"><span className={`notification-type notification-type--${notification.type.toLowerCase().replaceAll(' ', '-')}`}><Icon name={typeIcons[notification.type]} size={12} />{notification.type}</span><time>{notification.time}</time></span>
          </span>
          {notification.thumbnail && <span className={`notification-item__thumbnail notification-item__thumbnail--${notification.thumbnail}`} aria-hidden="true"><i /></span>}
          {!notification.read && <span className="notification-item__unread" aria-label="Unread" />}
        </button>
      </div>
      {notification.type === 'FOLLOW' && notification.followStatus === 'pending' && isPrivateAccount && (
        <div className="notification-follow-actions" aria-label={`Follow request from ${notification.person}`}>
          <button className="notification-follow-actions__confirm" type="button" onClick={() => onResolveFollow(notification, 'accepted')}>Confirm</button>
          <button className="notification-follow-actions__reject" type="button" onClick={() => onResolveFollow(notification, 'rejected')}>Reject</button>
        </div>
      )}
      {notification.type === 'FOLLOW' && notification.followStatus === 'pending' && !isPrivateAccount && notification.profileId && (
        <div className="notification-follow-actions">
          <span className="notification-follow-actions__status">Following you</span>
          <button className="notification-follow-actions__confirm" type="button" onClick={openMessage}>Message</button>
        </div>
      )}
      {notification.type === 'FOLLOW' && notification.followStatus === 'accepted' && notification.profileId && (
        <div className="notification-follow-actions">
          <span className="notification-follow-actions__status">Request confirmed</span>
          <button className={`notification-follow-actions__confirm${isFollowingBack(notification.profileId) ? ' is-following' : ''}`} type="button" aria-pressed={isFollowingBack(notification.profileId)} onClick={() => onFollowBack(notification.profileId)}>
            {isFollowingBack(notification.profileId) ? 'Following' : 'Follow back'}
          </button>
          <button className="notification-follow-actions__confirm" type="button" onClick={openMessage}>Message</button>
        </div>
      )}
      {notification.type === 'FOLLOW' && notification.followStatus === 'rejected' && (
        <div className="notification-follow-actions"><span className="notification-follow-actions__status">Request declined</span></div>
      )}
    </div>
  )
}

export default function NotificationsPage({ notifications, onNotificationsChange, onMarkRead, onMarkAllRead, onViewProfile, onResolveFollowRequest, onFollowBack, onMessageProfile, isPrivateAccount, isFollowingBack, loading, error }) {
  const [filter, setFilter] = useState('All')
  const [activeNotification, setActiveNotification] = useState(null)

  useEffect(() => {
    if (!activeNotification) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') setActiveNotification(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [activeNotification])

  const visibleNotifications = notifications.filter((item) => filter === 'All' || item.type === 'MENTION')
  const today = visibleNotifications.filter((item) => item.section === 'Today')
  const earlier = visibleNotifications.filter((item) => item.section === 'Earlier')

  function openNotification(notification) {
    onNotificationsChange((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item))
    onMarkRead?.(notification.id)
    if (notification.target === 'profile' && notification.profileId) {
      onViewProfile(notification.username || notification.profileId)
    } else if (notification.target === 'message' && notification.profileId) {
      onMessageProfile?.({
        id: notification.profileId,
        name: notification.person,
        username: notification.username || notification.profileId,
        initials: notification.initials,
        tone: notification.tone,
      })
    } else {
      setActiveNotification(notification)
    }
  }

  function markAllAsRead() {
    onNotificationsChange((current) => current.map((item) => ({ ...item, read: true })))
    onMarkAllRead?.()
  }

  function resolveFollow(notification, status) {
    onNotificationsChange((current) => current.map((item) => item.id === notification.id ? { ...item, read: true, followStatus: status } : item))
    onResolveFollowRequest(notification.profileId, status)
  }

  return (
    <div className="notifications-page">
      <header className="notifications-header">
        <div>
          <span className="notification-eyebrow"><span /> YOUR SPACE</span>
          <h1>Notifications</h1>
          <p>Stay up to date with what’s happening around you.</p>
        </div>
        <button className="notifications-mark-read" type="button" onClick={markAllAsRead} disabled={!notifications.some((item) => !item.read)}>
          <Icon name="check" size={15} /> Mark all as read
        </button>
      </header>

      <div className="notifications-controls">
        <div className="notifications-filters" role="tablist" aria-label="Filter notifications">
          {['All', 'Mentions'].map((option) => (
            <button type="button" role="tab" aria-selected={filter === option} className={filter === option ? 'is-active' : ''} key={option} onClick={() => setFilter(option)}>{option}</button>
          ))}
        </div>
        <span className="notifications-unread-count">{notifications.filter((item) => !item.read).length} unread</span>
      </div>

      {loading && <p className="notifications-empty" role="status">Loading notifications…</p>}
      {error && <p className="notifications-empty" role="alert">{error}</p>}

      {visibleNotifications.length ? (
        <div className="notifications-list">
          {today.length > 0 && <section className="notifications-group" aria-labelledby="notifications-today"><h2 id="notifications-today">Today</h2>{today.map((item) => <NotificationItem key={item.id} notification={item} onOpen={openNotification} onResolveFollow={resolveFollow} onFollowBack={onFollowBack} onMessageProfile={onMessageProfile} onViewProfile={onViewProfile} isPrivateAccount={isPrivateAccount} isFollowingBack={isFollowingBack} />)}</section>}
          {earlier.length > 0 && <section className="notifications-group" aria-labelledby="notifications-earlier"><h2 id="notifications-earlier">Earlier</h2>{earlier.map((item) => <NotificationItem key={item.id} notification={item} onOpen={openNotification} onResolveFollow={resolveFollow} onFollowBack={onFollowBack} onMessageProfile={onMessageProfile} onViewProfile={onViewProfile} isPrivateAccount={isPrivateAccount} isFollowingBack={isFollowingBack} />)}</section>}
        </div>
      ) : !loading && !error ? (
        <div className="notifications-empty" role="status"><span><Icon name="check" size={18} /></span><h2>You’re all caught up.</h2><p>New activity will appear here.</p></div>
      ) : null}

      {activeNotification && <NotificationViewer notification={activeNotification} onClose={() => setActiveNotification(null)} />}
    </div>
  )
}
