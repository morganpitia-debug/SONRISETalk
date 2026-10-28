import { useEffect, useState } from 'react'
import { addPostComment, getPostComments, getSavedPosts, setPostLiked, setPostSaved } from '../api/social.js'
import { isApiEnabled } from '../api/auth.js'
import ContentStream from './home/ContentStream.jsx'
import Icon from './Icon.jsx'
import UserAvatar from './UserAvatar.jsx'

const helpTopics = [
  {
    title: 'Find your way around',
    summary: 'What each main area is for.',
    steps: [
      'Home shows posts and stories from your community.',
      'Discover helps you find people and posts outside your feed.',
      'Messages is where you start private conversations and continue existing chats.',
      'Use More for saved posts, help, and account options. Admin accounts also have an Admin area.',
    ],
  },
  {
    title: 'Share posts and stories',
    summary: 'Create and manage what you share.',
    steps: [
      'Choose Create in the navigation to publish a text or media post.',
      'Choose Story when you want to share a short-lived moment; stories are available for 24 hours.',
      'Use the options on a post to save it, share its link, or mark it as not interesting.',
    ],
  },
  {
    title: 'Find saved posts',
    summary: 'Keep posts handy and return to them later.',
    steps: [
      'Tap the bookmark on a post, or choose Save post in its options.',
      'Open More, then Saved to see your saved posts.',
      'Tap the bookmark again or choose Remove saved post to take an item out of Saved.',
    ],
  },
  {
    title: 'Messages, media, and calls',
    summary: 'Keep conversations going in the way that works for you.',
    steps: [
      'Open Messages and select a conversation, or start one from someone’s profile.',
      'Use the microphone button to record a voice note, preview it, then send it. The message file picker does not upload file contents yet.',
      'Use the call controls in a conversation to start an audio or video call when the other person is available.',
    ],
  },
  {
    title: 'Profile, privacy, and notifications',
    summary: 'Manage how you appear and what you hear about.',
    steps: [
      'Open your profile to edit your name, username, bio, and profile photo.',
      'Open Settings to choose account privacy and review your experience preferences.',
      'Open Notifications to review updates and handle follow requests.',
    ],
  },
  {
    title: 'Use SONRISE AI',
    summary: 'Open SONRISE AI from the navigation for assistant features.',
    steps: [
      'Describe what you want help with, such as writing, exploring, or understanding something.',
      'Attach up to four supported images (JPEG, PNG, WebP, HEIC, or HEIF), PDFs, or TXT, MD, and CSV files. Each file can be up to 3 MB, with 12 MB total per message.',
      'Review the assistant’s response before using or sharing it.',
    ],
  },
]

export default function MoreDestinationPage({
  page,
  account,
  savedAccounts = [],
  onSelectAccount,
  onAddAccount,
  onViewProfile,
  localPosts = [],
  savedPostIds = [],
  onSaveLocalPost,
  followedProfileIds = [],
  onToggleFollow,
  onNavigate,
}) {
  const usesApi = isApiEnabled()
  const [savedPosts, setSavedPosts] = useState([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedError, setSavedError] = useState('')
  const [refreshSaved, setRefreshSaved] = useState(0)
  const [reactions, setReactions] = useState({})
  const [commentsByPost, setCommentsByPost] = useState({})
  const [actionError, setActionError] = useState('')
  const titles = { Saved: 'Saved', History: 'Your activity', 'Help & support': 'Help & support', 'About SONRISETALK': 'About SONRISETALK' }
  const currentUsername = account.username?.replace(/^@/, '').toLowerCase()

  useEffect(() => {
    if (page !== 'Saved') return undefined
    if (!usesApi) {
      setSavedPosts(localPosts.filter((post) => savedPostIds.includes(post.id)).map((post) => ({ ...post, saved: true })))
      setSavedError('')
      setSavedLoading(false)
      return undefined
    }
    let active = true
    setSavedLoading(true)
    setSavedError('')
    setSavedPosts([])
    getSavedPosts()
      .then(({ posts }) => {
        if (!Array.isArray(posts)) throw new Error('The saved-post service returned an unexpected response.')
        if (active) setSavedPosts(posts)
      })
      .catch((error) => {
        if (active) setSavedError(error.message || 'Your saved posts could not load.')
      })
      .finally(() => {
        if (active) setSavedLoading(false)
      })
    return () => { active = false }
  }, [localPosts, page, refreshSaved, savedPostIds, usesApi])

  function removeSavedPost(postId) {
    setActionError('')
    const previousPosts = savedPosts
    setSavedPosts((current) => current.filter((post) => post.id !== postId))
    if (!usesApi) {
      onSaveLocalPost?.(postId, false)
      return
    }
    setPostSaved(postId, false).catch((error) => {
      setSavedPosts(previousPosts)
      setActionError(error.message || 'This post could not be removed from Saved.')
    })
  }

  function togglePostLike(postId) {
    const post = savedPosts.find((item) => item.id === postId)
    const wasLiked = reactions[postId] ?? post?.liked ?? false
    const liked = !wasLiked
    setReactions((current) => ({ ...current, [postId]: liked }))
    if (!usesApi) return
    setPostLiked(postId, liked).catch((error) => {
      setReactions((current) => ({ ...current, [postId]: wasLiked }))
      setActionError(error.message || 'Your reaction could not be saved.')
    })
  }

  function updatePostComments(postId, text) {
    setActionError('')
    if (!text) {
      if (!usesApi) return
      getPostComments(postId)
        .then(({ comments }) => setCommentsByPost((current) => ({ ...current, [postId]: comments })))
        .catch((error) => setActionError(error.message || 'Comments could not load.'))
      return
    }
    if (!usesApi) {
      setCommentsByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? []), { id: `local-${Date.now()}`, name: 'You', text }],
      }))
      return
    }
    addPostComment(postId, text)
      .then(({ comment }) => setCommentsByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? []), comment],
      })))
      .catch((error) => setActionError(error.message || 'Your comment could not be posted.'))
  }

  return (
    <div className="settings-page more-destination">
      <header className="settings-header"><span className="settings-eyebrow"><span /> YOUR SPACE</span><h1>{titles[page] || page}</h1><p>{page === 'Saved' ? 'Posts you bookmarked are kept here so you can find them again.' : page === 'History' ? 'A simple record of things you have done.' : page === 'Help & support' ? 'Clear steps for using the main parts of SONRISETALK.' : page === 'Switch account' ? 'Choose an account saved on this device, or log in to add another.' : page === 'About SONRISETALK' ? 'A messaging and social space made to help people stay connected.' : 'A quieter kind of together.'}</p></header>
      {page === 'Saved' && <>
        <div className="saved-page__toolbar"><p>Only you can see the posts you save.</p><button className="settings-link-button" type="button" onClick={() => setRefreshSaved((current) => current + 1)} disabled={savedLoading}><Icon name="history" size={14} /> Refresh</button></div>
        {savedError && <div className="saved-page__error" role="alert"><span>{savedError}</span><button className="settings-link-button" type="button" onClick={() => setRefreshSaved((current) => current + 1)}>Try again</button></div>}
        {actionError && <p className="saved-page__error" role="alert">{actionError}</p>}
        {savedLoading
          ? <div className="feed-loading" role="status"><span className="feed-loading__spinner" />Loading saved posts...</div>
          : savedPosts.length
            ? <ContentStream posts={savedPosts} reactions={reactions} savedPosts={{}} commentsByPost={commentsByPost} followedProfileIds={followedProfileIds} onReact={togglePostLike} onDiscuss={updatePostComments} onToggleFollow={onToggleFollow} onSave={removeSavedPost} onLoadMore={() => {}} onViewProfile={onViewProfile} />
            : !savedError && <section className="settings-section-card saved-page__empty"><Icon name="saved" size={23} /><h2>No saved posts yet</h2><p>Bookmark a post to keep it here. When you want it again, open More → Saved.</p><button className="settings-link-button" type="button" onClick={() => onNavigate?.('Home')}>Browse posts</button></section>}
      </>}
      {page === 'History' && <section className="settings-section-card saved-page__empty"><Icon name="history" size={23} /><h2>Activity history isn’t available yet</h2><p>SONRISETALK does not currently keep a browsable activity log. Your saved posts are available in More → Saved, and updates appear in Notifications.</p><button className="settings-link-button" type="button" onClick={() => onNavigate?.('Notifications')}>Open notifications</button></section>}
      {page === 'Help & support' && <div className="help-guide">
        {helpTopics.map((topic) => <details className="settings-section-card help-guide__topic" key={topic.title}>
          <summary><span><strong>{topic.title}</strong><small>{topic.summary}</small></span><Icon name="chevron" size={16} /></summary>
          <ol>{topic.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </details>)}
        <p className="help-guide__note">This guide covers the features currently available in the app. If a button or feature is unavailable, it may not be enabled for your account or device yet.</p>
      </div>}
      {page === 'About SONRISETALK' && <section className="settings-section-card more-about">
        <span className="more-about__mark">ST</span>
        <h2>SONRISETALK</h2>
        <p className="more-about__purpose">A messaging and social platform for conversations, sharing stories, discovering people, and keeping the moments that matter.</p>
        <div className="more-about__features">
          <div><Icon name="messages" size={17} /><strong>Connect</strong><span>Keep up through messages and calls.</span></div>
          <div><Icon name="story" size={17} /><strong>Share</strong><span>Post updates and short-lived stories.</span></div>
          <div><Icon name="saved" size={17} /><strong>Return</strong><span>Save posts to find them again later.</span></div>
        </div>
        <p className="more-about__creator">Created by <strong>Ishimwe Pitia Morgan</strong> at age <strong>14</strong>.</p>
        <small>Made to give connection and sharing a more thoughtful place.</small>
      </section>}
      {page === 'Switch account' && <section className="settings-section-card switch-account-card">
        <h2>Saved accounts</h2>
        <p className="switch-account-card__hint">Accounts saved on this device</p>
        <div className="switch-account-list">
          {savedAccounts.map((savedAccount) => {
            const username = savedAccount.username.replace(/^@/, '')
            const selected = username.toLowerCase() === currentUsername
            const name = savedAccount.name || username
            return (
              <button
                className={`more-account more-account__saved${selected ? ' is-current' : ''}`}
                type="button"
                key={username}
                aria-current={selected ? 'true' : undefined}
                disabled={selected}
                onClick={() => onSelectAccount(username)}
              >
                <UserAvatar person={savedAccount} className="more-account__avatar more-account__photo" />
                <span className="more-account__select"><strong>{name}</strong><small>@{username}</small></span>
                {selected && <><small className="more-account__current-label">Current</small><Icon name="check" size={16} /></>}
              </button>
            )
          })}
          {savedAccounts.length === 0 && <p className="switch-account-card__empty">No saved accounts on this device yet.</p>}
        </div>
        <button className="settings-link-button more-add-account" type="button" onClick={onAddAccount}>
          <Icon name="add" size={16} /> Add account
        </button>
      </section>}
    </div>
  )
}
