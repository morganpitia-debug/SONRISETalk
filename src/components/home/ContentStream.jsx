import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import ProfilePhotoButton from '../ProfilePhotoButton.jsx'
import UserAvatar from '../UserAvatar.jsx'

const VIDEO_PLAY_EVENT = 'sonrisetalk:feed-video-play'

function formatVideoTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function PostDialog({ post, mode, comments, onClose, onAddComment }) {
  const [comment, setComment] = useState('')
  const [feedback, setFeedback] = useState('')
  const videoRef = useRef(null)

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/post/${encodeURIComponent(post.id)}`)
      setFeedback('Link copied')
    } catch (error) {
      console.error('Unable to copy post link.', error)
      setFeedback('Could not copy the link on this device.')
    }
  }

  function submitComment(event) {
    event.preventDefault()
    const text = comment.trim()
    if (!text) return
    onAddComment(post.id, text)
    setComment('')
  }

  return createPortal(
    <div className="feed-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`feed-dialog feed-dialog--${mode}`} role="dialog" aria-modal="true" aria-label={mode === 'comments' ? 'Comments' : mode === 'share' ? 'Share post' : 'Post'}>
        <header className="feed-dialog__header">
          <strong>{mode === 'comments' ? 'Comments' : mode === 'share' ? 'Share this post' : 'Post'}</strong>
          <button type="button" className="feed-dialog__close" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button>
        </header>

        {mode === 'post' && (
          <div className="feed-dialog__post">
            {post.media && (post.type === 'video' || post.type === 'reel'
              ? <video ref={videoRef} src={post.media} controls autoPlay muted playsInline aria-label={`${post.author}'s video`} />
              : <img src={post.media} alt={post.title} />)}
            <strong>{post.author}</strong>
            <p>{post.title} {post.body}</p>
          </div>
        )}

        {mode === 'comments' && (
          <>
            <div className="feed-dialog__comments">
              <div className="feed-dialog__caption"><strong>{post.author}</strong><span>{post.title} {post.body}</span></div>
              {comments.map((item) => <div className="feed-dialog__comment" key={item.id}><strong>{item.name}</strong><span>{item.text}</span></div>)}
              {!comments.length && <p className="feed-dialog__empty">No comments yet. Start the conversation.</p>}
            </div>
            <form className="feed-dialog__comment-form" onSubmit={submitComment}>
              <input aria-label="Write a comment" placeholder="Add a comment..." value={comment} onChange={(event) => setComment(event.target.value)} />
              <button type="submit" disabled={!comment.trim()}>Post</button>
            </form>
          </>
        )}

        {mode === 'share' && (
          <div className="feed-dialog__share">
            <button type="button" className="feed-dialog__share-action" onClick={copyLink}><Icon name="pass" size={18} /> Copy link</button>
            {feedback && <p className="feed-dialog__feedback" role="status">{feedback}</p>}
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}

function VideoPost({ post, onOpen }) {
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [aspectRatio, setAspectRatio] = useState('')
  const [buffering, setBuffering] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting && !video.paused) video.pause()
      }, { threshold: 0.25 })
      : null
    observer?.observe(video)
    const pauseOnAnotherPlay = (event) => {
      if (event.detail !== video && !video.paused) video.pause()
    }
    window.addEventListener(VIDEO_PLAY_EVENT, pauseOnAnotherPlay)
    return () => {
      observer?.disconnect()
      window.removeEventListener(VIDEO_PLAY_EVENT, pauseOnAnotherPlay)
      video.pause()
    }
  }, [retry, post.media])

  async function togglePlay(event) {
    event.stopPropagation()
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      try {
        window.dispatchEvent(new CustomEvent(VIDEO_PLAY_EVENT, { detail: video }))
        await video.play()
        setPlaying(true)
        setMediaError(false)
      } catch (error) {
        console.error('Unable to play feed video.', error)
        setMediaError(true)
      }
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  function toggleMute(event) {
    event.stopPropagation()
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }

  function seekVideo(event) {
    event.stopPropagation()
    const video = videoRef.current
    if (!video || !video.duration) return
    const nextProgress = Number(event.currentTarget.value)
    video.currentTime = (nextProgress / 100) * video.duration
    setProgress(nextProgress)
  }

  async function enterFullscreen(event) {
    event.stopPropagation()
    try {
      const frame = event.currentTarget.closest('.post-card__media--video')
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (frame?.requestFullscreen) await frame.requestFullscreen()
      else await videoRef.current?.requestFullscreen?.()
    } catch (error) {
      console.error('Unable to open feed video in fullscreen.', error)
    }
  }

  function handleVideoKeyDown(event) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      togglePlay(event)
    }
  }

  return (
    <div className={`post-card__media post-card__media--video${playing ? ' is-playing' : ''}`} onClick={onOpen} style={{ aspectRatio: aspectRatio || (post.type === 'reel' ? '9 / 16' : '16 / 9') }}>
      <video key={retry} ref={videoRef} src={post.media} muted={muted} playsInline preload="metadata" onClick={togglePlay} onKeyDown={handleVideoKeyDown} tabIndex={0} onLoadedMetadata={(event) => {
        const video = event.currentTarget
        setDuration(video.duration)
        if (video.videoWidth && video.videoHeight) setAspectRatio(`${video.videoWidth} / ${video.videoHeight}`)
        setBuffering(false)
        setMediaError(false)
      }} onTimeUpdate={(event) => {
        const video = event.currentTarget
        setCurrentTime(video.currentTime)
        setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0)
      }} onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)} onPlay={() => { setPlaying(true); setBuffering(false) }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setMediaError(true); setBuffering(false) }} aria-label={`${post.author}'s video`} />
      {buffering && <span className="post-card__video-loading" role="status">Loading video…</span>}
      {mediaError && <div className="post-card__video-error" role="alert"><span>Video couldn’t be played.</span><button type="button" onClick={(event) => { event.stopPropagation(); setMediaError(false); setBuffering(true); setRetry((count) => count + 1) }}>Try again</button></div>}
      <div className="post-card__video-controls" onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} size={17} /></button>
        <span className="post-card__video-time">{formatVideoTime(currentTime)} / {formatVideoTime(duration)}</span>
        <input className="post-card__video-progress" type="range" aria-label="Video progress" min="0" max="100" value={Math.round(progress)} style={{ '--video-progress': `${progress}%` }} onChange={seekVideo} />
        <button type="button" aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={toggleMute}><Icon name={muted ? 'mute' : 'volume'} size={17} /></button>
        <button type="button" aria-label={document.fullscreenElement ? 'Exit fullscreen' : 'View fullscreen'} onClick={enterFullscreen}><span aria-hidden="true">⛶</span></button>
      </div>
      <button type="button" className="post-card__open-media" aria-label={`Open ${post.author}'s post`} onClick={(event) => { event.stopPropagation(); onOpen() }}><Icon name="arrow" size={17} /></button>
    </div>
  )
}

function PostCard({ post, liked, followed, saved, comments, onReact, onDiscuss, onToggleFollow, onSave, onHide, onDelete, onViewProfile }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  function closeDialog() {
    setDialogMode(null)
  }

  function openDialog(mode) {
    setDialogMode(mode)
    if (mode === 'comments') onDiscuss(post.id)
  }

  const isVideo = post.type === 'video' || post.type === 'reel'

  return (
    <article className="post-card">
      <div className="post-card__header">
        <div className="post-card__author">
          <ProfilePhotoButton person={post} onViewProfile={onViewProfile}>
            <UserAvatar person={post} />
          </ProfilePhotoButton>
          <div className="post-card__author-info">
            <strong>{post.author}</strong>
            <span>@{post.handle?.replace(/^@/, '')} · {post.time}</span>
          </div>
        </div>
        <div className="post-card__more-wrap">
          <button type="button" className="post-card__more" aria-label="More options" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><Icon name="more" size={20} /></button>
          {moreOpen && <div className="post-card__more-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { onSave(post.id); setMoreOpen(false) }}>{saved ? 'Remove saved post' : 'Save post'}</button>
            {post.own && <button type="button" role="menuitem" onClick={async () => {
              if (!window.confirm('Delete this post? This cannot be undone.')) return
              setDeleteError('')
              const deleted = await onDelete?.(post)
              if (deleted) setMoreOpen(false)
              else setDeleteError('This post could not be deleted.')
            }}>Delete post</button>}
            {onHide && <button type="button" role="menuitem" onClick={() => { onHide(post.id); setMoreOpen(false) }}>Not interested</button>}
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); openDialog('share') }}>Copy or share link</button>
            {deleteError && <p className="post-card__menu-error" role="alert">{deleteError}</p>}
          </div>}
        </div>
      </div>

      {post.media ? (
        isVideo
          ? <VideoPost post={post} onOpen={() => openDialog('post')} />
          : <button type="button" className="post-card__media post-card__media--image" onClick={() => openDialog('post')} aria-label={`Open ${post.author}'s post`}>
            <img src={post.media} alt={post.title} loading="lazy" />
            {post.type === 'reel' && <span className="post-card__reel-label">REEL</span>}
          </button>
      ) : (
        <button type="button" className={`post-card__text-media bg--${post.tone}`} onClick={() => openDialog('post')}>
          <span>{post.context}</span><h3>{post.title}</h3><p>{post.body}</p>
        </button>
      )}

      <div className="post-card__creator">
        <ProfilePhotoButton person={post} onViewProfile={onViewProfile}>
          <UserAvatar person={post} />
        </ProfilePhotoButton>
        <button type="button" className="post-card__creator-name" onClick={() => onViewProfile?.(post.handle)}><strong>{post.author}</strong><span>@{post.handle?.replace(/^@/, '')}</span></button>
        <button type="button" className={`post-card__follow${followed ? ' is-following' : ''}`} onClick={() => onToggleFollow?.({ id: post.profileId, name: post.author, username: post.handle, isPrivate: post.isPrivate })}>{followed ? 'Following' : 'Follow'}</button>
      </div>

      <div className="post-card__actions">
        <div className="post-card__actions-left">
          <button type="button" className={liked ? 'is-selected' : ''} onClick={onReact} aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked}><Icon name="heart" size={23} /><span>{post.resonated + (liked ? 1 : 0)}</span></button>
          <button type="button" onClick={() => openDialog('comments')} aria-label="Comments"><Icon name="messages" size={22} /><span>{comments.length || post.replies || 0}</span></button>
          <button type="button" onClick={() => openDialog('share')} aria-label="Forward or share"><Icon name="pass" size={22} /></button>
        </div>
        <button type="button" className={saved ? 'is-selected' : ''} aria-label={saved ? 'Remove saved post' : 'Save post'} aria-pressed={saved} onClick={() => onSave(post.id)}><Icon name="save" size={22} /></button>
      </div>

      <div className="post-card__footer">
        <div className="post-card__likes"><strong>{post.resonated + (liked ? 1 : 0)} likes</strong></div>
        <div className="post-card__caption"><strong>@{post.handle?.replace(/^@/, '')}</strong> {post.title} {post.body}</div>
        {comments.length > 0 && <button className="post-card__view-comments" type="button" onClick={() => openDialog('comments')}>View all {comments.length} comments</button>}
      </div>

      {dialogMode && <PostDialog post={post} mode={dialogMode} comments={comments} onClose={closeDialog} onAddComment={onDiscuss} />}
    </article>
  )
}

export default function ContentStream({ posts, reactions, savedPosts, commentsByPost, followedProfileIds, onReact, onDiscuss, onToggleFollow, onSave, onHide, onDelete, onLoadMore, onViewProfile, loadingMore, loading }) {
  const sentinelRef = useRef(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !('IntersectionObserver' in window)) return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
    }, { rootMargin: '500px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoadMore])

  return (
    <section className="content-stream feed-stream" aria-label="Posts">
      {posts.length ? (
        <div className="feed-list">
          {posts.map((post) => (
            <PostCard key={post.id} post={post}
              liked={reactions[post.id] ?? post.liked}
              followed={followedProfileIds.includes(post.profileId)}
              saved={savedPosts[post.id] ?? post.saved}
              comments={commentsByPost[post.id] ?? post.comments ?? []}
              onReact={() => onReact(post.id)}
              onDiscuss={(postId, text) => onDiscuss(postId, text)}
              onToggleFollow={() => onToggleFollow?.({ id: post.profileId, name: post.author, username: post.handle, isPrivate: post.isPrivate })}
              onSave={onSave}
              onHide={onHide}
              onDelete={onDelete}
              onViewProfile={onViewProfile}
            />
          ))}
        </div>
      ) : loading ? <div className="feed-loading" role="status"><span className="feed-loading__spinner" />Loading posts...</div> : <div className="stream-empty"><span className="stream-empty__glyph"><Icon name="messages" size={20} /></span><strong>No posts yet.</strong><span>Posts from people you follow will appear here.</span></div>}
      <div ref={sentinelRef} className="feed-load-sentinel" aria-hidden="true" />
      {loadingMore && <div className="feed-loading" role="status"><span className="feed-loading__spinner" />Loading more posts...</div>}
    </section>
  )
}
