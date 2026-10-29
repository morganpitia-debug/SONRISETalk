import { useEffect, useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import ProfilePhotoButton from '../ProfilePhotoButton.jsx'
import UserAvatar from '../UserAvatar.jsx'
import { getDiscoverPosts, getStories, searchUsers } from '../../api/social.js'
import { isApiEnabled } from '../../api/auth.js'

function matchesQuery(query, values) {
  const normalizedQuery = query.trim().toLowerCase()
  return !normalizedQuery || values.some((value) => String(value || '').toLowerCase().includes(normalizedQuery))
}

export default function DiscoverPage({ onViewProfile, followedProfileIds = [], followRequestsSentIds = [], onToggleFollow, localPosts = [], localStories = [], currentUser = {} }) {
  const usesApi = isApiEnabled()
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState([])
  const [stories, setStories] = useState(localStories)
  const [content, setContent] = useState(localPosts.map((post) => ({
    ...post,
    type: post.type === 'video' || post.type === 'reel' || post.format === 'Reel' ? 'Reel' : 'Post',
    author: post.author || currentUser.name || 'You',
    handle: post.handle || (currentUser.username ? `@${currentUser.username}` : ''),
    detail: post.body || post.caption || post.title,
    activity: post.activity || 'New',
  })))
  const [activeItem, setActiveItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchLoading, setSearchLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchError, setSearchError] = useState('')

  useEffect(() => {
    if (!usesApi) {
      setLoading(false)
      return undefined
    }
    let active = true
    Promise.all([getStories(), getDiscoverPosts()])
      .then(([storyResult, postResult]) => {
        if (!active) return
        setStories(storyResult.stories)
        setContent(postResult.posts.map((post) => ({
          ...post,
          type: post.type === 'video' ? 'Reel' : 'Post',
          handle: `@${post.handle}`,
          detail: post.body || post.title,
          activity: `${post.resonated} resonated`,
        })))
        setError('')
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Discover could not load right now.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [usesApi])

  useEffect(() => {
    if (usesApi) return
    setStories(localStories)
    setContent(localPosts.map((post) => ({
      ...post,
      type: post.type === 'video' || post.type === 'reel' || post.format === 'Reel' ? 'Reel' : 'Post',
      author: post.author || currentUser.name || 'You',
      handle: post.handle || (currentUser.username ? `@${currentUser.username}` : ''),
      detail: post.body || post.caption || post.title,
      activity: post.activity || 'New',
    })))
  }, [currentUser.name, currentUser.username, localPosts, localStories, usesApi])

  useEffect(() => {
    if (!usesApi) {
      setPeople([])
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      setSearchError('')
      searchUsers(query, { signal: controller.signal })
        .then((result) => setPeople(result.users))
        .catch((requestError) => {
          if (requestError.name !== 'AbortError') {
            setSearchError(requestError.message || 'User search could not load right now.')
            setPeople([])
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false)
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, usesApi])

  const visibleStories = useMemo(
    () => stories.filter((story) => matchesQuery(query, [story.name, story.caption])),
    [query, stories],
  )
  const visibleStoryGroups = useMemo(() => {
    const groups = new Map()
    for (const story of [...visibleStories].sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))) {
      const ownerId = story.profileId || story.userId || story.username
      if (!ownerId) continue
      const group = groups.get(ownerId)
      if (group) group.items.push(story)
      else groups.set(ownerId, { ...story, items: [story] })
    }
    return [...groups.values()]
  }, [visibleStories])
  const visibleContent = useMemo(
    () => content.filter((item) => matchesQuery(query, [item.type, item.author, item.handle, item.title, item.detail])),
    [content, query],
  )
  const hasResults = people.length + visibleStoryGroups.length + visibleContent.length > 0

  function openStoryGroup(group) {
    setActiveItem({
      ...group.items[0],
      type: 'Story',
      mediaType: group.items[0].type,
      author: group.name,
      segments: group.items,
      segmentIndex: 0,
    })
  }

  function moveStorySegment(direction) {
    setActiveItem((current) => {
      if (current?.type !== 'Story' || !current.segments) return current
      const segmentIndex = current.segmentIndex + direction
      if (segmentIndex < 0 || segmentIndex >= current.segments.length) return current
      return {
        ...current,
        ...current.segments[segmentIndex],
        type: 'Story',
        mediaType: current.segments[segmentIndex].type,
        segments: current.segments,
        segmentIndex,
        author: current.name,
      }
    })
  }

  useEffect(() => {
    if (activeItem?.type !== 'Story') return undefined
    function navigateStory(event) {
      if (event.key === 'ArrowRight') moveStorySegment(1)
      if (event.key === 'ArrowLeft') moveStorySegment(-1)
      if (event.key === 'Escape') setActiveItem(null)
    }
    document.addEventListener('keydown', navigateStory)
    return () => document.removeEventListener('keydown', navigateStory)
  }, [activeItem])

  return (
    <div className="discover-page">
      <header className="discover-header">
        <span className="discover-eyebrow"><span /> DISCOVER</span>
      </header>

      <label className="discover-search">
        <Icon name="search" size={19} />
        <span className="visually-hidden">Search Trex</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Trex" autoComplete="off" />
        {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={17} /></button>}
      </label>

      {searchLoading && <p className="discover-empty" role="status">Searching accounts…</p>}
      {searchError && <p className="discover-empty" role="alert">{searchError}</p>}
      {error && <p className="discover-empty" role="alert">{error}</p>}

      {loading ? (
        <p className="discover-empty" role="status">Loading your world…</p>
      ) : hasResults ? (
        <div className="discover-sections">
          {people.length > 0 && (
            <section className="discover-section discover-section--people" aria-labelledby="discover-people">
              <div className="discover-section__heading"><h2>People</h2><span>{people.length} accounts</span></div>
              <div className="discover-people">
                {people.map((person) => {
                  const following = followedProfileIds.includes(person.id) || person.following
                  const requestSent = followRequestsSentIds.includes(person.id) || person.requested
                  return (
                    <article className="discover-person" key={person.id}>
                      <button className="discover-person__profile" type="button" aria-label={`View ${person.name}'s profile`} onClick={() => onViewProfile?.(person.username)}>
                        <UserAvatar person={person} className="discover-person__avatar" />
                        <span className="discover-person__copy"><strong>{person.name}</strong><small>{person.handle}</small></span>
                      </button>
                      <button className={`discover-button${following || requestSent ? ' is-selected' : ''}`} type="button" aria-pressed={following || requestSent} onClick={() => onToggleFollow?.(person)}>
                        {following ? 'Following' : requestSent ? 'Request sent' : 'Follow'}
                      </button>
                    </article>
                  )
                })}
              </div>
            </section>
          )}

          {visibleStoryGroups.length > 0 && (
            <section className="discover-section" aria-labelledby="discover-stories">
              <div className="discover-section__heading"><h2 id="discover-stories">Stories</h2><span>Fresh from your world</span></div>
              <div className="discover-stories">
                {visibleStoryGroups.map((group) => (
                  <div className="discover-story" key={group.profileId || group.userId || group.username}>
                    <button className="profile-photo-button" type="button" aria-label={`View ${group.name}'s stories (${group.items.length})`} onClick={() => openStoryGroup(group)}>
                      <UserAvatar person={group} className="discover-story__avatar" />
                      {group.items.length > 1 && <span className="discover-story__count">{group.items.length}</span>}
                    </button>
                    <button type="button" onClick={() => openStoryGroup(group)}>{group.name}</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {visibleContent.length > 0 && (
            <section className="discover-section discover-section--content" aria-labelledby="discover-content">
              <div className="discover-section__heading"><h2 id="discover-content">Posts &amp; Reels</h2><span>Worth a moment</span></div>
              <div className="discover-content">
                {visibleContent.map((item) => (
                  <button className={`discover-content-item discover-content-item--${item.tone}`} type="button" key={item.id} onClick={() => setActiveItem(item)}>
                    <span className="discover-content-item__type">{item.type === 'Reel' && <Icon name="play" size={14} />}{item.type}</span>
                    <span className="discover-content-item__title">{item.title}</span>
                    <span className="discover-content-item__detail">{item.detail}</span>
                    <span className="discover-content-item__author">{item.author} <i /> {item.activity}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : !searchLoading && !searchError && !error ? (
        <p className="discover-empty" role="status">No public accounts, stories, or posts are available yet.</p>
      ) : null}

      {activeItem && (
        <div className="discover-preview-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setActiveItem(null)}>
          <section className={`discover-preview${activeItem.type === 'Story' ? ' discover-preview--story' : ''}`} role="dialog" aria-modal="true" aria-label={`${activeItem.type} preview`}>
            <button className="discover-preview__close" type="button" aria-label="Close preview" onClick={() => setActiveItem(null)}><Icon name="close" size={18} /></button>
            {activeItem.type === 'Story'
              ? <div className="discover-preview__story-media">
                {activeItem.media
                  ? activeItem.mediaType === 'video'
                    ? <video src={activeItem.media} autoPlay muted playsInline controls onEnded={() => moveStorySegment(1)} />
                    : <img src={activeItem.media} alt={`${activeItem.author}'s story`} onError={() => moveStorySegment(1)} />
                  : <UserAvatar person={activeItem} className="discover-preview__avatar" />}
                <ProfilePhotoButton className="discover-preview__story-profile" person={activeItem} onViewProfile={(profile) => {
                  setActiveItem(null)
                  onViewProfile?.(profile)
                }}>
                  {activeItem.profilePicture
                    ? <img className="avatar discover-preview__avatar" src={activeItem.profilePicture} alt="" />
                    : <UserAvatar person={activeItem} className="discover-preview__avatar" />}
                </ProfilePhotoButton>
                <strong>{activeItem.author}</strong>
                {activeItem.segments?.length > 1 && <span className="discover-preview__counter">{activeItem.segmentIndex + 1} / {activeItem.segments.length}</span>}
                {activeItem.segmentIndex > 0 && <button className="discover-preview__story-nav is-previous" type="button" aria-label="Previous story" onClick={() => moveStorySegment(-1)}><Icon name="chevron" size={19} /></button>}
                {activeItem.segmentIndex < (activeItem.segments?.length ?? 1) - 1 && <button className="discover-preview__story-nav is-next" type="button" aria-label="Next story" onClick={() => moveStorySegment(1)}><Icon name="chevron" size={19} /></button>}
              </div>
              : <ProfilePhotoButton person={activeItem} onViewProfile={onViewProfile}>
                {activeItem.profilePicture
                  ? <img className="avatar discover-preview__avatar" src={activeItem.profilePicture} alt="" />
                  : <UserAvatar person={activeItem} className="discover-preview__avatar" />}
              </ProfilePhotoButton>}
            {activeItem.type !== 'Story' && <>
              <span className="discover-preview__type">{activeItem.type}</span>
              <h2>{activeItem.title || activeItem.caption}</h2>
              {activeItem.detail && <p>{activeItem.detail}</p>}
              <span className="discover-preview__author">{activeItem.author}{activeItem.handle ? ` · ${activeItem.handle}` : ''}</span>
            </>}
          </section>
        </div>
      )}
    </div>
  )
}
