import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import BrandMark from './BrandMark.jsx'
import FloatingNavigation from './FloatingNavigation.jsx'
import GlassSurface from './GlassSurface.jsx'
import Icon from './Icon.jsx'
import CallOverlay from './messages/CallOverlay.jsx'
import useCallManager, { CallManagerContext } from '../hooks/useCallManager.js'
import MoreMenu from './MoreMenu.jsx'
import MoreDestinationPage from './MoreDestinationPage.jsx'
import PageTransition from './PageTransition.jsx'
import WordMark from './WordMark.jsx'
import UnderwaterFishLayer from './UnderwaterFishLayer.jsx'
import { isApiEnabled } from '../api/auth.js'
import { getMyFollows, getNotifications, getPrivacySettings, markAllNotificationsRead, markNotificationRead, resolveFollowRequest as resolveFollowRequestApi, setFollowed, updatePrivacySettings } from '../api/social.js'
import { getAdminStatus, promoteToAdmin } from '../api/admin.js'
import { readAIConversations, saveAIConversations } from '../utils/aiConversationHistory.js'
import { getConversations } from '../api/messaging.js'

const DiscoverPage = lazy(() => import('./discover/DiscoverPage.jsx'))
const CreatePage = lazy(() => import('./create/CreatePage.jsx'))
const HomePage = lazy(() => import('./home/HomePage.jsx'))
const MessagesPage = lazy(() => import('./messages/MessagesPage.jsx'))
const NotificationsPage = lazy(() => import('./notifications/NotificationsPage.jsx'))
const ProfilePage = lazy(() => import('./profile/ProfilePage.jsx'))
const SettingsPage = lazy(() => import('./settings/SettingsPage.jsx'))
const SonriseAIPage = lazy(() => import('./sonriseAi/SonriseAIPage.jsx'))
const AdminPage = lazy(() => import('./admin/AdminPage.jsx'))

function readLocalSavedPostIds(userId) {
  try {
    const saved = window.localStorage.getItem(`sonrisetalk-saved-posts-${userId || 'guest'}`)
    const parsed = saved ? JSON.parse(saved) : []
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch (error) {
    console.error('Could not read locally saved posts.', error)
    return []
  }
}

const pageCopy = {
  Home: ['A place to', 'find your people.'],
  Messages: ['Conversations', 'have room to grow.'],
  'SONRISE AI': ['A little light', 'when you need it.'],
}

export default function AppShell({ activePage, onNavigate, theme, onThemeChange, sceneTheme, onSceneThemeChange, onLogout, authUser, savedAccounts, onSelectSavedAccount, onAddAccount, onUpdateSavedAccount }) {
  const isHome = activePage === 'Home'
  const isDiscover = activePage === 'Discover'
  const isMessages = activePage === 'Messages'
  const isCreate = activePage === 'Create'
  const isProfile = activePage === 'Profile'
  const isNotifications = activePage === 'Notifications'
  const isSettings = activePage === 'Settings'
  const isSonriseAI = activePage === 'SONRISE AI'
  const isAdminPage = activePage === 'Admin'
  const usesApi = isApiEnabled()
  const callManager = useCallManager(usesApi && Boolean(authUser?.id))
  const isMoreDestination = ['Saved', 'History', 'Help & support', 'About SONRISETALK', 'Switch account', 'Admin'].includes(activePage)
  const [firstLine, secondLine] = pageCopy[activePage] ?? pageCopy.Home
  const [navExpanded, setNavExpanded] = useState(false)
  const [messagesChatOpen, setMessagesChatOpen] = useState(false)
  const [profile, setProfile] = useState(() => ({
    id: authUser?.id ?? '',
    name: authUser?.name ?? '',
    username: authUser?.username ?? '',
    initials: authUser?.initials ?? '',
    bio: authUser?.bio ?? '',
    photo: authUser?.profilePicture ?? null,
    tone: 'amber',
    postCount: 0,
    followerCount: 0,
    followingCount: 0,
  }))
  const [localPosts, setLocalPosts] = useState([])
  const [localStories, setLocalStories] = useState([])
  const [localSavedPostIds, setLocalSavedPostIds] = useState(() => readLocalSavedPostIds(authUser?.id))
  const [viewedProfile, setViewedProfile] = useState(null)
  const [followedProfileIds, setFollowedProfileIds] = useState([])
  const [followRequestsSentIds, setFollowRequestsSentIds] = useState([])
  const [confirmedFollowerIds, setConfirmedFollowerIds] = useState([])
  const [privateAccount, setPrivateAccount] = useState(false)
  const [createFormat, setCreateFormat] = useState('Post')
  const [viewedStoryIds, setViewedStoryIds] = useState([])
  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(Boolean(authUser && usesApi))
  const [notificationError, setNotificationError] = useState('')
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)
  const [relationshipError, setRelationshipError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminPromotionEnabled, setAdminPromotionEnabled] = useState(false)
  const [adminStatusError, setAdminStatusError] = useState('')
  const [messageProfile, setMessageProfile] = useState(null)
  const [profileEditRequested, setProfileEditRequested] = useState(false)
  const [settingsInitialSection, setSettingsInitialSection] = useState(null)
  const [aiPermissions, setAIPermissions] = useState({ profile: true, posts: true, messages: false, activity: false })
  const accountId = authUser?.id || 'guest'
  const [aiConversationState, setAIConversationState] = useState(() => ({
    userId: accountId,
    conversations: readAIConversations(accountId),
  }))
  const aiConversations = aiConversationState.userId === accountId ? aiConversationState.conversations : []
  const [activeAIConversationId, setActiveAIConversationId] = useState(null)
  const setAIConversations = useCallback((update) => {
    setAIConversationState((current) => {
      const conversations = current.userId === accountId
        ? current.conversations
        : readAIConversations(accountId)
      return {
        userId: accountId,
        conversations: typeof update === 'function' ? update(conversations) : update,
      }
    })
  }, [accountId])
  const previousPageRef = useRef('Home')
  const lastPageRef = useRef(activePage)
  const [moreOpen, setMoreOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  useEffect(() => {
    if (activePage === 'SONRISE AI') previousPageRef.current = lastPageRef.current
    lastPageRef.current = activePage
  }, [activePage])

  useEffect(() => {
    setAIConversationState({ userId: accountId, conversations: readAIConversations(accountId) })
    setActiveAIConversationId(null)
  }, [accountId])

  useEffect(() => {
    if (aiConversationState.userId !== accountId) return
    saveAIConversations(accountId, aiConversationState.conversations)
  }, [accountId, aiConversationState])

  useEffect(() => {
    try {
      window.localStorage.setItem(`sonrisetalk-saved-posts-${authUser?.id || 'guest'}`, JSON.stringify(localSavedPostIds))
    } catch (error) {
      console.error('Could not save locally saved posts.', error)
    }
  }, [authUser?.id, localSavedPostIds])

  useEffect(() => {
    if (!authUser || !usesApi) {
      setNotifications([])
      setNotificationsLoading(false)
      setUnreadMessageCount(0)
      return undefined
    }
    let active = true
    let refreshing = false
    const refreshCounts = () => {
      if (refreshing) return
      refreshing = true
      Promise.all([getNotifications(), getConversations()])
        .then(([notificationResult, conversationResult]) => {
          if (!active) return
          setNotifications(notificationResult.notifications)
          setUnreadMessageCount(conversationResult.conversations.reduce((total, conversation) => total + (conversation.unread || 0), 0))
          setNotificationError('')
        })
        .catch((error) => {
          if (active) setNotificationError(error.message || 'Unread counts could not be refreshed.')
        })
        .finally(() => {
          refreshing = false
          if (active) setNotificationsLoading(false)
        })
    }
    setNotificationsLoading(true)
    refreshCounts()
    const interval = window.setInterval(refreshCounts, 20_000)
    document.addEventListener('visibilitychange', refreshCounts)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshCounts)
    }
  }, [authUser?.id, usesApi])

  useEffect(() => {
    if (!authUser || !usesApi) {
      setIsAdmin(false)
      setAdminPromotionEnabled(false)
      setAdminStatusError('')
      return undefined
    }
    let active = true
    getAdminStatus()
      .then(({ isAdmin: admin, promotionEnabled }) => {
        if (!active) return
        setIsAdmin(admin)
        setAdminPromotionEnabled(promotionEnabled)
        setAdminStatusError('')
      })
      .catch((error) => {
        if (active) setAdminStatusError(error.message || 'Admin access status could not load.')
      })
    return () => { active = false }
  }, [authUser?.id, usesApi])

  useEffect(() => {
    if (!authUser || !usesApi) {
      setPrivateAccount(false)
      return undefined
    }
    let active = true
    getPrivacySettings()
      .then(({ privacy }) => {
        if (active) setPrivateAccount(privacy.isPrivate)
      })
      .catch((error) => {
        if (active) setRelationshipError(error.message || 'Privacy settings could not load.')
      })
    return () => { active = false }
  }, [authUser?.id, usesApi])

  useEffect(() => {
    if (!authUser || !usesApi) {
      setFollowedProfileIds([])
      setFollowRequestsSentIds([])
      setConfirmedFollowerIds([])
      return undefined
    }
    let active = true
    getMyFollows()
      .then(({ followingIds, followerIds, requestIds }) => {
        if (!active) return
        setFollowedProfileIds(followingIds)
        setConfirmedFollowerIds(followerIds)
        setFollowRequestsSentIds(requestIds)
      })
      .catch((error) => {
        if (active) setRelationshipError(error.message || 'Follow relationships could not load.')
      })
    return () => { active = false }
  }, [authUser?.id, usesApi])

  const updateCurrentProfile = useCallback((nextProfile) => {
    setProfile(nextProfile)
    if (!authUser) return
    const storage = window.localStorage.getItem('sonrisetalk-auth-token')
      ? window.localStorage
      : window.sessionStorage
    storage.setItem('sonrisetalk-auth-profile', JSON.stringify({
      ...authUser,
      id: nextProfile.id,
      name: nextProfile.name,
      username: nextProfile.username,
      profilePicture: nextProfile.photo,
    }))
    onUpdateSavedAccount({
      id: nextProfile.id,
      name: nextProfile.name,
      username: nextProfile.username,
      profilePicture: nextProfile.photo,
    })
  }, [authUser, onUpdateSavedAccount])

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') setLogoutOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [])

  function showProfile(target) {
    const nextProfile = typeof target === 'string' ? { username: target.replace(/^@/, '') } : target
    setViewedProfile(nextProfile || null)
    onNavigate('Profile')
  }

  function navigateToPage(page) {
    if (page === 'Admin' && !isAdmin) return
    if (page === 'Profile') setViewedProfile(null)
    if (page === 'Create') setCreateFormat('Post')
    if (page !== 'Settings') setSettingsInitialSection(null)
    setMoreOpen(false)
    onNavigate(page)
  }

  function openStoryCreator() {
    setCreateFormat('Story')
    onNavigate('Create')
  }

  const markStoryViewed = useCallback((storyId) => {
    setViewedStoryIds((current) => current.includes(storyId) ? current : [...current, storyId])
  }, [])

  function toggleFollow(targetProfile) {
    const target = typeof targetProfile === 'string' ? { id: targetProfile } : targetProfile
    const profileId = target.id
    if (!profileId) return
    const wasFollowing = followedProfileIds.includes(profileId)
    const hadRequested = followRequestsSentIds.includes(profileId)
    const shouldFollow = !wasFollowing && !hadRequested
    setRelationshipError('')
    setFollowedProfileIds((current) => shouldFollow && !target.isPrivate
      ? [...current, profileId]
      : current.filter((id) => id !== profileId))
    setFollowRequestsSentIds((current) => shouldFollow && target.isPrivate
      ? [...current, profileId]
      : current.filter((id) => id !== profileId))
    if (!usesApi) return
    setFollowed(profileId, shouldFollow)
      .then((result) => {
        const { status } = result || {}
        if (status === 'requested') {
          setFollowedProfileIds((current) => current.filter((id) => id !== profileId))
          setFollowRequestsSentIds((current) => current.includes(profileId) ? current : [...current, profileId])
        } else if (shouldFollow) {
          setFollowRequestsSentIds((current) => current.filter((id) => id !== profileId))
          setFollowedProfileIds((current) => current.includes(profileId) ? current : [...current, profileId])
        }
      })
      .catch((error) => {
        setFollowedProfileIds((current) => wasFollowing && !current.includes(profileId) ? [...current, profileId] : current.filter((id) => id !== profileId))
        setFollowRequestsSentIds((current) => hadRequested && !current.includes(profileId) ? [...current, profileId] : current.filter((id) => id !== profileId))
        setRelationshipError(error.message || 'That follow change could not be saved.')
      })
  }

  function resolveFollowRequest(profileId, status) {
    if (!profileId) return
    const wasConfirmed = confirmedFollowerIds.includes(profileId)
    setConfirmedFollowerIds((current) => status === 'accepted'
      ? current.includes(profileId) ? current : [...current, profileId]
      : current.filter((id) => id !== profileId))
    if (!usesApi) return
    resolveFollowRequestApi(profileId, status).catch((error) => {
      setConfirmedFollowerIds((current) => wasConfirmed
        ? current.includes(profileId) ? current : [...current, profileId]
        : current.filter((id) => id !== profileId))
      setRelationshipError(error.message || 'That follow request could not be updated.')
    })
  }

  function markRead(notificationId) {
    if (!usesApi) return
    markNotificationRead(notificationId).catch((error) => setNotificationError(error.message || 'The notification could not be marked as read.'))
  }

  function markAllRead() {
    if (!usesApi) return
    markAllNotificationsRead().catch((error) => setNotificationError(error.message || 'Notifications could not be marked as read.'))
  }

  function changePrivateAccount(isPrivate) {
    const previousValue = privateAccount
    setPrivateAccount(isPrivate)
    setRelationshipError('')
    if (!usesApi) return
    updatePrivacySettings({ isPrivate }).catch((error) => {
      setPrivateAccount(previousValue)
      setRelationshipError(error.message || 'Your privacy setting could not be saved.')
    })
  }

  function openProfileMessage(person) {
    setViewedProfile(null)
    setMessageProfile({ ...person, requestId: `${person.id}-${Date.now()}` })
    onNavigate('Messages')
  }

  function replyToStory(story, message) {
    if (!story.profileId || story.profileId === profile.id) return
    openProfileMessage({
      id: story.profileId,
      name: story.name,
      username: story.username,
      initials: story.initials,
      tone: story.tone,
      profilePicture: story.profilePicture,
      initialMessage: {
        id: `${story.id}-${Date.now()}`,
        text: message,
        contextLabel: 'story_reply',
      },
    })
  }

  function selectMoreItem(item) {
    setMoreOpen(false)
    onNavigate(item)
  }

  function addLocalContent({ kind, item }) {
    if (kind === 'story') setLocalStories((current) => [item, ...current])
    else setLocalPosts((current) => [item, ...current])
  }

  function deleteLocalPost(postId) {
    setLocalPosts((current) => current.filter((post) => post.id !== postId))
    setLocalSavedPostIds((current) => current.filter((id) => id !== postId))
  }

  function toggleLocalSavedPost(postId, saved) {
    setLocalSavedPostIds((current) => saved
      ? current.includes(postId) ? current : [...current, postId]
      : current.filter((id) => id !== postId))
  }

  function openProfileEditor() {
    setViewedProfile(null)
    setProfileEditRequested(true)
    onNavigate('Profile')
  }

  function openAIPermissions() {
    setSettingsInitialSection('ai')
    onNavigate('Settings')
  }

  const enableAdminAccess = useCallback(async (password) => {
    if (!usesApi) throw new Error('Admin privileges require a server-backed account.')
    const result = await promoteToAdmin(password)
    if (!result.isAdmin) throw new Error('The server did not enable admin privileges.')
    setIsAdmin(true)
    setAdminPromotionEnabled(true)
    setAdminStatusError('')
  }, [usesApi])

  function confirmLogout() {
    setLogoutOpen(false)
    setMoreOpen(false)
    onLogout()
  }

  const effectiveFollowerIds = privateAccount
    ? confirmedFollowerIds
    : [...new Set([
      ...confirmedFollowerIds,
      ...notifications
        .filter((notification) => notification.type === 'FOLLOW' && notification.followStatus !== 'rejected' && notification.profileId)
        .map((notification) => notification.profileId),
    ])]
  const unreadNotificationCount = notifications.filter((notification) => !notification.read).length

  return (
    <div className={`app-shell${sceneTheme === 'underwater' ? ' app-shell--underwater' : ''}${isHome ? ' app-shell--home' : ''}${isDiscover ? ' app-shell--discover' : ''}${isMessages ? ' app-shell--messages' : ''}${isCreate ? ' app-shell--create' : ''}${isProfile ? ' app-shell--profile' : ''}${isNotifications ? ' app-shell--notifications' : ''}${isSonriseAI ? ' app-shell--sonrise-ai' : ''}${isSettings || isMoreDestination ? ' app-shell--settings' : ''}${navExpanded ? ' is-nav-expanded' : ''}${isMessages && messagesChatOpen ? ' is-mobile-chat-open' : ''}`}>
      <div className="underwater-base" aria-hidden="true" />
      {sceneTheme === 'underwater' && <UnderwaterFishLayer />}
      <div className="app-shell__foreground">
      {!isSonriseAI && <header className="topbar">
        <WordMark />
        <div className="topbar__tools">
          <GlassSurface as="button" className={`utility-button${isNotifications ? ' is-current' : ''}`} type="button" aria-label={`Notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ''}`} aria-current={isNotifications ? 'page' : undefined} onClick={() => onNavigate('Notifications')}>
            <Icon name="notifications" size={18} />
            {unreadNotificationCount > 0 && <span className="utility-button__badge" aria-hidden="true">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}
          </GlassSurface>
          <GlassSurface as="button" className={`utility-button${isSettings ? ' is-current' : ''}`} type="button" aria-label="Settings" aria-current={isSettings ? 'page' : undefined} onClick={() => onNavigate('Settings')}>
            <Icon name="settings" size={18} />
          </GlassSurface>
        </div>
      </header>}

      {!isSonriseAI && <FloatingNavigation activePage={activePage} onNavigate={navigateToPage} expanded={navExpanded} onHoverChange={setNavExpanded} onMoreToggle={() => setMoreOpen((open) => !open)} moreOpen={moreOpen} isAdmin={isAdmin} unreadMessageCount={unreadMessageCount} />}

      <CallManagerContext.Provider value={callManager}>
      <PageTransition page={activePage}>
        <Suspense fallback={<div className="page-loading" role="status">Loading…</div>}>
        {relationshipError && <p className="stream-error" role="alert">{relationshipError}</p>}
        {adminStatusError && <p className="stream-error" role="alert">{adminStatusError}</p>}
        {isHome ? <HomePage onNavigate={onNavigate} onCreateStory={openStoryCreator} onReplyStory={replyToStory} onSwitchAccount={() => navigateToPage('Switch account')} viewedStoryIds={viewedStoryIds} onStoryViewed={markStoryViewed} onViewProfile={showProfile} onDeleteLocalPost={deleteLocalPost} followedProfileIds={followedProfileIds} onToggleFollow={toggleFollow} onSavePost={toggleLocalSavedPost} savedPostIds={localSavedPostIds} currentUser={{ id: profile.id, name: profile.name, username: profile.username, profilePicture: profile.photo }} localPosts={localPosts} localStories={localStories} /> : isDiscover ? <DiscoverPage onViewProfile={showProfile} followedProfileIds={followedProfileIds} followRequestsSentIds={followRequestsSentIds} onToggleFollow={toggleFollow} localPosts={localPosts} localStories={localStories} currentUser={profile} /> : isMessages ? <MessagesPage onMobileChatChange={setMessagesChatOpen} openProfile={messageProfile} onViewProfile={showProfile} currentUser={{ id: profile.id, name: profile.name, username: profile.username, initials: profile.initials, tone: profile.tone, profilePicture: profile.photo }} /> : isCreate ? <CreatePage initialFormat={createFormat} onCreate={addLocalContent} onNavigate={navigateToPage} currentUser={profile} /> : isProfile ? <ProfilePage profile={profile} onProfileChange={updateCurrentProfile} viewedProfile={viewedProfile} onViewProfile={showProfile} followedProfileIds={followedProfileIds} followRequestsSentIds={followRequestsSentIds} confirmedFollowerIds={effectiveFollowerIds} onToggleFollow={toggleFollow} onMessageProfile={openProfileMessage} openEdit={profileEditRequested} onEditOpened={() => setProfileEditRequested(false)} /> : isNotifications ? <NotificationsPage notifications={notifications} onNotificationsChange={setNotifications} onMarkRead={markRead} onMarkAllRead={markAllRead} onViewProfile={showProfile} onResolveFollowRequest={resolveFollowRequest} onFollowBack={toggleFollow} onMessageProfile={openProfileMessage} isPrivateAccount={privateAccount} isFollowingBack={(profileId) => followedProfileIds.includes(profileId)} loading={notificationsLoading} error={notificationError} /> : isSonriseAI ? <SonriseAIPage conversations={aiConversations} setConversations={setAIConversations} activeConversationId={activeAIConversationId} setActiveConversationId={setActiveAIConversationId} onManagePermissions={openAIPermissions} onBack={() => onNavigate(previousPageRef.current || 'Home')} /> : isSettings ? <SettingsPage profile={profile} theme={theme} onThemeChange={onThemeChange} sceneTheme={sceneTheme} onSceneThemeChange={onSceneThemeChange} onOpenProfile={openProfileEditor} isPrivateAccount={privateAccount} onPrivateAccountChange={changePrivateAccount} initialSection={settingsInitialSection} onInitialSectionOpened={() => setSettingsInitialSection(null)} aiPermissions={aiPermissions} onAIPermissionsChange={setAIPermissions} isAdmin={isAdmin} adminPromotionEnabled={adminPromotionEnabled} onAdminPromote={enableAdminAccess} /> : isAdminPage && isAdmin ? <AdminPage /> : isMoreDestination && !isAdminPage ? <MoreDestinationPage page={activePage} account={profile} savedAccounts={savedAccounts} onSelectAccount={onSelectSavedAccount} onAddAccount={onAddAccount} onViewProfile={showProfile} localPosts={localPosts} savedPostIds={localSavedPostIds} onSaveLocalPost={toggleLocalSavedPost} followedProfileIds={followedProfileIds} onToggleFollow={toggleFollow} onNavigate={navigateToPage} /> : (
          <section className="welcome welcome--placeholder" aria-label={`${activePage} foundation`}>
            <div className="welcome__overline"><span className="welcome__line" />A NEW KIND OF TOGETHER</div>
            <h1>{firstLine}<br /><span>{secondLine}</span></h1>
            <p>This space is just beginning.</p>
            <div className="welcome__signature"><span className="signature-dot" />HERE, WITH YOU</div>
          </section>
        )}
        </Suspense>
      </PageTransition>
      </CallManagerContext.Provider>

      <CallOverlay
        call={callManager.call}
        localStream={callManager.localStream}
        remoteStream={callManager.remoteStream}
        muted={callManager.muted}
        cameraEnabled={callManager.cameraEnabled}
        error={callManager.callError}
        clearError={callManager.clearCallError}
        onAccept={callManager.acceptCall}
        onDecline={callManager.declineCall}
        onEnd={callManager.endCall}
        onToggleMute={callManager.toggleMute}
        onToggleCamera={callManager.toggleCamera}
      />

      {!isHome && !isDiscover && !isMessages && !isCreate && !isProfile && !isNotifications && !isSonriseAI && !isSettings && !isMoreDestination && <div className="orbit" aria-hidden="true">
        <span className="orbit__ring orbit__ring--outer" />
        <span className="orbit__ring orbit__ring--inner" />
        <span className="orbit__axis orbit__axis--horizontal" />
        <span className="orbit__axis orbit__axis--vertical" />
        <span className="orbit__core"><BrandMark size={42} /></span>
        <span className="orbit__node orbit__node--one" />
        <span className="orbit__node orbit__node--two" />
        <span className="orbit__node orbit__node--three" />
      </div>}

      {!isHome && !isDiscover && !isMessages && !isCreate && !isProfile && !isNotifications && !isSonriseAI && !isSettings && !isMoreDestination && <footer className="footnote"><span>SONRISETALK</span><span>AN OPENING, NOT A FEED.</span></footer>}
      {moreOpen && <MoreMenu onClose={() => setMoreOpen(false)} onSelect={selectMoreItem} onLogout={() => { setMoreOpen(false); setLogoutOpen(true) }} />}
      {logoutOpen && <div className="settings-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setLogoutOpen(false)}><section className="settings-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title"><h2 id="logout-title">Log out of SONRISETALK?</h2><p>You can always log back in later.</p><div><button className="settings-secondary-button" type="button" onClick={() => setLogoutOpen(false)}>Cancel</button><button className="settings-danger-button" type="button" onClick={confirmLogout}>Log out</button></div></section></div>}
      </div>
    </div>
  )
}