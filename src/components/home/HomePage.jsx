import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ContentStream from './ContentStream.jsx'
import { CurrentUserProfile, HomeAIShortcut, SuggestedPeople, StoriesPanel } from './HomeSections.jsx'
import Icon from '../Icon.jsx'
import ProfilePhotoButton from '../ProfilePhotoButton.jsx'
import UserAvatar from '../UserAvatar.jsx'
import { addPostComment, deletePost, deleteStory, getFeed, getPostComments, getStories, getStoryInsights, markStoryViewed, muteStoryAuthor, searchUsers, setPostLiked, setPostSaved, setStoryLiked } from '../../api/social.js'
import { isApiEnabled } from '../../api/auth.js'

function readDeletedLocalStoryIds(userId) {
  try {
    const stored = window.localStorage.getItem(`sonrisetalk-deleted-stories-${userId || 'guest'}`)
    const parsed = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch (error) {
    console.error('Could not read locally deleted stories.', error)
    return []
  }
}

function StoryViewer({ story, storySegments, isPaused, isMuted, insightsLoading, onPauseChange, onMuteChange, onClose, onComplete, onNext, onReply, onLike, onDelete, onMute, onViewProfile }) {
  const [durations, setDurations] = useState({})
  const [liked, setLiked] = useState(Boolean(story.liked))
  const [reply, setReply] = useState('')
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [optionsError, setOptionsError] = useState('')
  const duration = durations[story.id] || 5
  const videoRef = useRef(null)
  const photoRemainingRef = useRef(5000)

  useEffect(() => {
    onPauseChange(false)
    onMuteChange(true)
    setLiked(Boolean(story.liked))
    setReply('')
    setInsightsOpen(false)
    setOptionsOpen(false)
    setOptionsError('')
    photoRemainingRef.current = 5000
  }, [story.id, onPauseChange, onMuteChange])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') onNext(story.id)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [story.id, onClose, onNext])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  useEffect(() => {
    if (story.type === 'video' || isPaused) return undefined
    const startedAt = Date.now()
    const timer = window.setTimeout(() => onNext(story.id), photoRemainingRef.current)
    return () => {
      window.clearTimeout(timer)
      photoRemainingRef.current = Math.max(0, photoRemainingRef.current - (Date.now() - startedAt))
    }
  }, [story.id, story.type, isPaused, onNext])

  function togglePlayback() {
    if (story.type === 'video' && videoRef.current) {
      if (isPaused) {
        videoRef.current.play().catch((error) => console.error('Unable to resume story playback.', error))
      } else {
        videoRef.current.pause()
      }
    }
    onPauseChange(!isPaused)
  }

  function renderInsightAccount(person, liked) {
    return (
      <li key={person.id}>
        <ProfilePhotoButton className="story-viewer__insight-account" person={person} onViewProfile={(profile) => {
          onClose()
          onViewProfile(profile)
        }}>
          <UserAvatar person={person} className="story-viewer__insight-avatar" />
          <span className="story-viewer__insight-copy"><strong>{person.name}</strong><span>@{person.username}</span></span>
        </ProfilePhotoButton>
        {liked && <Icon className="story-viewer__insight-heart" name="heart" size={15} />}
      </li>
    )
  }

  return createPortal(
    <div className="story-viewer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="story-viewer" role="dialog" aria-modal="true" aria-label={`${story.name}'s story`}>
        <div className={`story-viewer__stage${story.type === 'video' ? ' has-video' : ''}`}>
          {story.type === 'video'
            ? <video ref={videoRef} className="story-viewer__media" src={story.media} autoPlay muted={isMuted} playsInline onLoadedMetadata={(event) => setDurations((current) => ({ ...current, [story.id]: Math.max(event.currentTarget.duration, 1) }))} onEnded={() => onNext(story.id)} onError={() => onComplete(story.id)} aria-label={`${story.name}'s story video`} />
            : <img className="story-viewer__media" src={story.media} alt={`${story.name}'s story`} />}
          <div className="story-viewer__scrim" aria-hidden="true" />
          <div className="story-viewer__progress" aria-hidden="true">{storySegments.map((segment) => {
            const activeSegment = segment.id === story.id
            const completedSegment = storySegments.findIndex((item) => item.id === story.id) > storySegments.findIndex((item) => item.id === segment.id)
            return <span className="story-viewer__progress-segment" key={segment.id}><i className={completedSegment ? 'is-complete' : ''}>{activeSegment && <b key={story.id} style={{ animationDuration: `${duration}s`, animationPlayState: isPaused ? 'paused' : 'running' }} />}</i></span>
          })}</div>
          <div className="story-viewer__header">
            <button className="story-viewer__return" type="button" aria-label="Return to feed" onClick={onClose}><Icon name="back" size={19} /></button>
            <div className="story-viewer__options">
              <button type="button" className="story-viewer__control" aria-label="Story options" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}><Icon name="more" size={18} /></button>
              {optionsOpen && <div className="story-viewer__options-menu" role="menu">
                {story.own
                  ? <button type="button" role="menuitem" onClick={async () => {
                    if (!window.confirm('Delete this story? This cannot be undone.')) return
                    const deleted = await onDelete(story)
                    if (deleted) setOptionsOpen(false)
                    else setOptionsError('This story could not be deleted.')
                  }}>Delete story</button>
                  : <button type="button" role="menuitem" onClick={async () => {
                    const muted = await onMute(story)
                    if (muted) setOptionsOpen(false)
                    else setOptionsError('These stories could not be muted.')
                  }}>Mute {story.name}&apos;s stories</button>}
                {optionsError && <p role="alert">{optionsError}</p>}
              </div>}
            </div>
            <ProfilePhotoButton className="story-viewer__profile" person={story} onViewProfile={(profile) => {
              onClose()
              onViewProfile(profile)
            }}>
              <UserAvatar person={story} className={`avatar--${story.tone}`} />
            </ProfilePhotoButton>
            <span className="story-viewer__profile-copy"><strong>{story.name}</strong></span>
          </div>
          <div className={`story-viewer__controls${story.type === 'video' ? ' is-video' : ''}`}>
            {story.type === 'video' && <button type="button" className="story-viewer__control" aria-label={isMuted ? 'Unmute story' : 'Mute story'} aria-pressed={!isMuted} onClick={() => onMuteChange((muted) => !muted)}><Icon name={isMuted ? 'mute' : 'volume'} size={17} /></button>}
            <button type="button" className="story-viewer__control" aria-label={isPaused ? 'Resume story' : 'Pause story'} aria-pressed={isPaused} onClick={togglePlayback}><Icon name={isPaused ? 'play' : 'pause'} size={17} /></button>
          </div>
          {story.caption && <p className="story-viewer__caption">{story.caption}</p>}
          {story.own ? (
            <>
              {insightsOpen && <section className="story-viewer__insights" aria-label="Story views and likes">
                <button className="story-viewer__insights-close" type="button" aria-label="Close story insights" onClick={() => setInsightsOpen(false)}><Icon name="close" size={15} /></button>
                <div><strong>Views · {story.viewCount ?? story.viewers?.length ?? 0}</strong>
                  {insightsLoading
                    ? <p>Loading views…</p>
                    : story.viewers?.length
                    ? <ul>{story.viewers.map((viewer) => renderInsightAccount(viewer, story.likers?.some((liker) => liker.id === viewer.id)))}</ul>
                    : <p>No views yet.</p>}
                </div>
                <div><strong>Likes · {story.likeCount ?? story.likers?.length ?? 0}</strong>
                  {insightsLoading
                    ? <p>Loading likes…</p>
                    : story.likers?.length
                    ? <ul>{story.likers.map((liker) => renderInsightAccount(liker, true))}</ul>
                    : <p>No likes yet.</p>}
                </div>
              </section>}
              <div className="story-viewer__actions story-viewer__actions--owner">
                <button className="story-viewer__insights-toggle" type="button" aria-expanded={insightsOpen} onClick={() => { setInsightsOpen((open) => !open); if (!isPaused) togglePlayback() }}>
                  <Icon name="eye" size={18} /><span>{story.viewCount ?? story.viewers?.length ?? 0}</span>
                  <Icon name="heart" size={17} /><span>{story.likeCount ?? story.likers?.length ?? 0}</span>
                </button>
              </div>
            </>
          ) : (
            <div className="story-viewer__actions">
              <button className={`story-viewer__like${liked ? ' is-liked' : ''}`} type="button" aria-label={liked ? 'Unlike story' : 'Like story'} aria-pressed={liked} onClick={() => {
                const nextLiked = !liked
                setLiked(nextLiked)
                onLike(story.id, nextLiked)
              }}><Icon name="heart" size={23} /></button>
              <form className="story-viewer__reply" onSubmit={(event) => {
                event.preventDefault()
                const message = reply.trim()
                if (!message) return
                onReply(story, message)
              }}>
                <label className="visually-hidden" htmlFor={`story-reply-${story.id}`}>Reply to {story.name}'s story</label>
                <input id={`story-reply-${story.id}`} value={reply} onChange={(event) => setReply(event.target.value)} onFocus={() => { if (!isPaused) togglePlayback() }} placeholder={`Reply to ${story.name}…`} maxLength={1000} />
                <button type="submit" aria-label={`Send reply to ${story.name}`} disabled={!reply.trim()}><Icon name="send" size={17} /></button>
              </form>
            </div>
          )}
        </div>
        <button className="story-viewer__arrow story-viewer__arrow--next" type="button" aria-label="Next story" onClick={() => onNext(story.id)}><Icon name="chevron" size={22} /></button>
      </section>
    </div>,
    document.body,
  )
}

export default function HomePage({ onNavigate, onCreateStory, onReplyStory, onStoryViewed, onSwitchAccount, onViewProfile, onDeleteLocalPost, followedProfileIds = [], followRequestsSentIds = [], onToggleFollow, onSavePost, savedPostIds = [], currentUser, localPosts = [], localStories = [] }) {
  const usesApi = isApiEnabled()
  const [posts, setPosts] = useState(localPosts)
  const [stories, setStories] = useState(localStories)
  const [suggestedPeople, setSuggestedPeople] = useState([])
  const [reactions, setReactions] = useState({})
  const [savedPosts, setSavedPosts] = useState({})
  const [storyLikes, setStoryLikes] = useState({})
  const [mutedStoryAuthors, setMutedStoryAuthors] = useState([])
  const [deletedLocalStoryIds, setDeletedLocalStoryIds] = useState(() => readDeletedLocalStoryIds(currentUser?.id))
  const [storyInsightsLoading, setStoryInsightsLoading] = useState({})
  const [commentsByPost, setCommentsByPost] = useState({})
  const [hiddenPostIds, setHiddenPostIds] = useState([])
  const [feedError, setFeedError] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingRef = useRef(false)
  const cursorRef = useRef(null)
  const [activeStoryId, setActiveStoryId] = useState(null)
  const [storyPaused, setStoryPaused] = useState(false)
  const [storyMuted, setStoryMuted] = useState(true)
  const activeStory = stories.find((story) => story.id === activeStoryId)
  const orderedStories = [...stories].sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
  const ownStories = orderedStories.filter((story) => story.own)
  const storyGroups = orderedStories.reduce((groups, story) => {
    const group = groups.find((item) => item.profileId === story.profileId)
    if (group) group.items.push(story)
    else groups.push({ profileId: story.profileId, items: [story] })
    return groups
  }, [])
  const firstOwnStory = ownStories[0]
  const storySegments = storyGroups.find((group) => group.items.some((story) => story.id === activeStoryId))?.items ?? (activeStory ? [activeStory] : [])
  const otherStoryGroups = storyGroups.filter((group) => !group.items[0].own && !mutedStoryAuthors.includes(group.profileId)).map((group) => ({
    ...group.items[0],
    firstStoryId: group.items[0].id,
    viewed: group.items.every((story) => story.viewed),
  }))

  useEffect(() => {
    const expireStories = () => setStories((current) => current.filter((story) => (
      !story.expiresAt || Date.parse(story.expiresAt) > Date.now()
    )))
    expireStories()
    const timer = window.setInterval(expireStories, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (usesApi) return
    setPosts(localPosts)
    setStories(localStories.filter((story) => !deletedLocalStoryIds.includes(story.id)))
  }, [localPosts, localStories, usesApi, deletedLocalStoryIds])

  useEffect(() => {
    try {
      window.localStorage.setItem(`sonrisetalk-deleted-stories-${currentUser?.id || 'guest'}`, JSON.stringify(deletedLocalStoryIds))
    } catch (error) {
      console.error('Could not save locally deleted stories.', error)
    }
  }, [currentUser?.id, deletedLocalStoryIds])

  useEffect(() => {
    setDeletedLocalStoryIds(readDeletedLocalStoryIds(currentUser?.id))
  }, [currentUser?.id])

  const recordStoryViewed = useCallback((storyId) => {
    const story = stories.find((item) => item.id === storyId)
    if (!story?.own) {
      setStories((current) => current.map((item) => item.id === storyId ? { ...item, viewed: true } : item))
    }
    if (!story?.own) onStoryViewed?.(storyId)
    if (usesApi && !story?.own) markStoryViewed(storyId).catch((error) => console.error('Could not save story view:', error))
  }, [onStoryViewed, stories, usesApi])

  const completeStory = useCallback((storyId) => {
    recordStoryViewed(storyId)
    setActiveStoryId(null)
  }, [recordStoryViewed])

  const nextStory = useCallback((storyId) => {
    recordStoryViewed(storyId)
    const currentIndex = orderedStories.findIndex((story) => story.id === storyId)
    const currentStory = orderedStories[currentIndex]
    const sameAuthorNext = orderedStories.slice(currentIndex + 1).find((story) => story.profileId === currentStory?.profileId)
    if (sameAuthorNext) {
      setActiveStoryId(sameAuthorNext.id)
      return
    }
    if (currentStory?.own) {
      setActiveStoryId(null)
      return
    }
    const currentGroupIndex = storyGroups.findIndex((group) => group.profileId === currentStory?.profileId)
    const nextGroup = storyGroups.slice(currentGroupIndex + 1).find((group) => !group.items[0].own && !mutedStoryAuthors.includes(group.profileId))
    setActiveStoryId(nextGroup?.items[0].id ?? null)
  }, [mutedStoryAuthors, orderedStories, recordStoryViewed, storyGroups])

  const openStory = useCallback((storyId) => {
    setActiveStoryId(storyId)
    const story = stories.find((item) => item.id === storyId)
    if (usesApi && story?.own) {
      setStoryInsightsLoading((current) => ({ ...current, [storyId]: true }))
      getStoryInsights(storyId)
        .then((insights) => setStories((current) => current.map((item) => item.id === storyId
          ? {
            ...item,
            viewers: insights.viewers,
            likers: insights.likers,
            viewCount: insights.viewers.length,
            likeCount: insights.likers.length,
          }
          : item)))
        .catch((error) => setFeedError(error.message || 'Story views and likes could not load.'))
        .finally(() => setStoryInsightsLoading((current) => ({ ...current, [storyId]: false })))
    }
  }, [stories, usesApi])

  const toggleStoryLike = useCallback((storyId, liked) => {
    const story = stories.find((item) => item.id === storyId)
    const previousLiked = storyLikes[storyId] ?? story?.liked ?? false
    setStoryLikes((current) => ({ ...current, [storyId]: liked }))
    setStories((current) => current.map((item) => item.id === storyId
      ? { ...item, liked, likeCount: Math.max(0, (item.likeCount ?? 0) + (liked ? 1 : -1)) }
      : item))
    if (!usesApi) return
    setStoryLiked(storyId, liked).catch((error) => {
      setStoryLikes((current) => ({ ...current, [storyId]: previousLiked }))
      setStories((current) => current.map((item) => item.id === storyId
        ? { ...item, liked: previousLiked, likeCount: story?.likeCount ?? 0 }
        : item))
      console.error('Could not update story like:', error)
    })
  }, [storyLikes, stories, usesApi])

  async function removeStory(story) {
    if (!story.own) return false
    try {
      if (usesApi) await deleteStory(story.id)
      else setDeletedLocalStoryIds((current) => current.includes(story.id) ? current : [...current, story.id])
      setStories((current) => current.filter((item) => item.id !== story.id))
      setActiveStoryId(null)
      return true
    } catch (error) {
      setFeedError(error.message || 'This story could not be deleted.')
      return false
    }
  }

  async function muteStory(story) {
    if (story.own) return false
    try {
      if (usesApi) await muteStoryAuthor(story.id)
      else setMutedStoryAuthors((current) => current.includes(story.profileId) ? current : [...current, story.profileId])
      setStories((current) => current.filter((item) => item.profileId !== story.profileId))
      setActiveStoryId(null)
      return true
    } catch (error) {
      setFeedError(error.message || `Stories from ${story.name} could not be muted.`)
      return false
    }
  }

  useEffect(() => {
    if (!usesApi) {
      setInitialLoading(false)
      return undefined
    }
    let active = true
    Promise.all([getFeed(), getStories(), searchUsers('')])
      .then(([feed, storyResult, suggestions]) => {
        if (!active) return
        if (!Array.isArray(feed?.posts) || !Array.isArray(storyResult?.stories) || !Array.isArray(suggestions?.users)) {
          throw new Error('The feed service returned an unexpected response.')
        }
        setPosts(feed.posts)
        cursorRef.current = feed.nextCursor
        setStories(storyResult.stories)
        setSuggestedPeople(suggestions.users)
        setFeedError('')
      })
      .catch((error) => {
        if (active) setFeedError(error.message || 'Your feed could not load right now.')
      })
      .finally(() => {
        if (active) setInitialLoading(false)
      })
    return () => { active = false }
  }, [usesApi])

  const loadMore = useCallback(() => {
    if (!usesApi || loadingRef.current || !cursorRef.current) return
    loadingRef.current = true
    setLoadingMore(true)
    getFeed({ cursor: cursorRef.current })
      .then((result) => {
        setPosts((current) => [...current, ...result.posts])
        cursorRef.current = result.nextCursor
        setFeedError('')
      })
      .catch((error) => setFeedError(error.message || 'More posts could not load right now.'))
      .finally(() => {
        setLoadingMore(false)
        loadingRef.current = false
      })
  }, [usesApi])

  function updateComments(postId, text) {
    if (!text) {
      if (!usesApi) {
        const post = posts.find((item) => item.id === postId)
        setCommentsByPost((current) => ({ ...current, [postId]: current[postId] ?? post?.comments ?? [] }))
        return
      }
      getPostComments(postId)
        .then(({ comments }) => setCommentsByPost((current) => ({ ...current, [postId]: comments })))
        .catch((error) => setFeedError(error.message || 'Comments could not load right now.'))
      return
    }
    if (!usesApi) {
      setCommentsByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? posts.find((item) => item.id === postId)?.comments ?? []), {
          id: `local-${Date.now()}`,
          name: currentUser?.name || 'You',
          text,
        }],
      }))
      return
    }
    addPostComment(postId, text)
      .then(({ comment }) => setCommentsByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? []), comment],
      })))
      .catch((error) => setFeedError(error.message || 'Your comment could not be posted.'))
  }

  function toggleLike(postId) {
    const post = posts.find((item) => item.id === postId)
    const wasLiked = reactions[postId] ?? post?.liked ?? false
    const nextLiked = !wasLiked
    setReactions((current) => ({ ...current, [postId]: nextLiked }))
    if (!usesApi) return
    setPostLiked(postId, nextLiked).catch((error) => {
      setReactions((current) => ({ ...current, [postId]: wasLiked }))
      setFeedError(error.message || 'Your reaction could not be saved.')
    })
  }

  function toggleSaved(postId) {
    const post = posts.find((item) => item.id === postId)
    const wasSaved = savedPosts[postId] ?? (usesApi ? post?.saved : savedPostIds.includes(postId)) ?? false
    const nextSaved = !wasSaved
    setSavedPosts((current) => ({ ...current, [postId]: nextSaved }))
    if (!usesApi) {
      onSavePost?.(postId, nextSaved)
      return
    }
    setPostSaved(postId, nextSaved).catch((error) => {
      setSavedPosts((current) => ({ ...current, [postId]: wasSaved }))
      setFeedError(error.message || 'Your saved post could not be updated.')
    })
  }

  async function removePost(post) {
    if (!post.own) return false
    try {
      if (usesApi) await deletePost(post.id)
      else onDeleteLocalPost?.(post.id)
      setPosts((current) => current.filter((item) => item.id !== post.id))
      setSavedPosts((current) => {
        const next = { ...current }
        delete next[post.id]
        return next
      })
      setReactions((current) => {
        const next = { ...current }
        delete next[post.id]
        return next
      })
      setCommentsByPost((current) => {
        const next = { ...current }
        delete next[post.id]
        return next
      })
      setFeedError('')
      return true
    } catch (error) {
      setFeedError(error.message || 'This post could not be deleted.')
      return false
    }
  }

  return (
    <div className="home-page home-page--social">
      <div className="home-grid">
        <div className="home-main">
          {feedError && <p className="stream-error" role="alert">{feedError}</p>}
          <StoriesPanel onAddStory={onCreateStory} onOpenStory={openStory} stories={otherStoryGroups} ownStory={firstOwnStory} currentUser={currentUser} onViewProfile={onViewProfile} />
          <ContentStream
            posts={posts.filter((post) => !hiddenPostIds.includes(post.id))}
            reactions={reactions}
            savedPosts={usesApi ? savedPosts : Object.fromEntries(savedPostIds.map((postId) => [postId, true]))}
            commentsByPost={commentsByPost}
            followedProfileIds={followedProfileIds}
            loadingMore={loadingMore}
            onReact={toggleLike}
            onDiscuss={updateComments}
            onToggleFollow={onToggleFollow}
            onSave={toggleSaved}
            onHide={(id) => setHiddenPostIds((current) => [...current, id])}
            onDelete={removePost}
            onLoadMore={loadMore}
            onViewProfile={onViewProfile}
            loading={initialLoading}
          />
        </div>
        <aside className="home-rail" aria-label="Suggested people and stories">
          <CurrentUserProfile user={currentUser} onSwitchAccount={onSwitchAccount} onViewProfile={onViewProfile} />
          <SuggestedPeople people={suggestedPeople} onViewProfile={onViewProfile} followedProfileIds={followedProfileIds} followRequestsSentIds={followRequestsSentIds} onToggleFollow={onToggleFollow} />
          <HomeAIShortcut onOpen={() => onNavigate('Sonrise AI')} />
        </aside>
      </div>
      {activeStory && <StoryViewer story={{ ...activeStory, liked: storyLikes[activeStory.id] ?? activeStory.liked }} storySegments={storySegments} isPaused={storyPaused} isMuted={storyMuted} insightsLoading={Boolean(storyInsightsLoading[activeStory.id])} onPauseChange={setStoryPaused} onMuteChange={setStoryMuted} onClose={() => setActiveStoryId(null)} onComplete={completeStory} onNext={nextStory} onReply={(story, text) => onReplyStory?.(story, text)} onLike={toggleStoryLike} onDelete={removeStory} onMute={muteStory} onViewProfile={onViewProfile} />}
    </div>
  )
}