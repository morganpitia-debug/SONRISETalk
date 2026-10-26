import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import {
  createHighlight,
  deleteHighlight,
  getHighlight,
  getHighlightStories,
  reorderHighlights,
  updateHighlight,
  uploadMedia,
} from '../../api/social.js'

function storyIdsFrom(highlight) {
  return (highlight?.items || []).map((item) => item.id)
}

function HighlightCover({ highlight, className = '' }) {
  return (
    <span className={`profile-highlight__cover${className ? ` ${className}` : ''}`}>
      {highlight.coverType === 'video'
        ? <><video src={highlight.coverUrl} muted playsInline preload="metadata" aria-hidden="true" /><span className="profile-highlight__video-badge"><Icon name="play" size={11} /></span></>
        : <img src={highlight.coverUrl} alt="" loading="lazy" />}
      <span className="profile-highlight__ring" />
    </span>
  )
}

function HighlightEditor({ highlight, profile, onClose, onSave, onDelete, usesApi }) {
  const [stories, setStories] = useState([])
  const [selectedIds, setSelectedIds] = useState(storyIdsFrom(highlight))
  const [coverStoryId, setCoverStoryId] = useState('')
  const [existingCoverUrl, setExistingCoverUrl] = useState(highlight?.coverUrl || '')
  const [coverFile, setCoverFile] = useState(null)
  const [title, setTitle] = useState(highlight?.title || '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')
  const [storyLoadError, setStoryLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  const coverInputRef = useRef(null)
  const coverPreview = useObjectUrl(coverFile)
  const selectedStories = selectedIds.map((id) => stories.find((story) => story.id === id)).filter(Boolean)
  const selectedCover = selectedStories.find((story) => story.id === coverStoryId)
  const defaultCover = selectedStories.find((story) => story.type === 'image') || selectedStories[0]
  const previewUrl = coverPreview || selectedCover?.media || existingCoverUrl || defaultCover?.media || ''
  const previewType = coverPreview ? 'image' : selectedCover?.type || (existingCoverUrl ? highlight?.coverType : defaultCover?.type) || 'image'
  const hasCoverImage = Boolean(coverPreview || selectedCover?.type === 'image'
    || (existingCoverUrl && highlight?.coverType === 'image')
    || (!coverStoryId && !existingCoverUrl && defaultCover?.type === 'image'))

  useEffect(() => {
    if (!usesApi) {
      setLoading(false)
      setError('Sign in to an account to create and save Highlights.')
      setStoryLoadError('Sign in to an account to create and save Highlights.')
      return undefined
    }
    let active = true
    setLoading(true)
    setStoryLoadError('')
    setError('')
    const requests = [getHighlightStories()]
    if (highlight?.id) requests.push(getHighlight(highlight.id))
    Promise.all(requests)
      .then(([storyResult, detailResult]) => {
        if (!active) return
        const availableStories = storyResult.stories || []
        setStories(availableStories)
        if (detailResult?.highlight) {
          const detail = detailResult.highlight
          const detailItems = detail.items || []
          setSelectedIds(detailItems.map((item) => item.id))
          setTitle(detail.title)
          const matchingCover = detailItems.find((item) => item.media === detail.coverUrl && item.type === 'image')
          setCoverStoryId(matchingCover?.id || '')
          setExistingCoverUrl(matchingCover ? '' : detail.coverUrl)
        }
        if (!availableStories.length) {
          setError(highlight?.id
            ? 'No stories are available for this Highlight right now. You can still update its title or cover.'
            : 'You do not have any stories yet. Share a story first, then come back to add it to a Highlight.')
        }
      })
      .catch((requestError) => {
        if (active) {
          const message = requestError.message || 'Your stories could not be loaded.'
          setError(message)
          setStoryLoadError(message)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [highlight?.id, reloadCount, usesApi])

  function toggleStory(storyId) {
    if (selectedIds.includes(storyId)) {
      if (coverStoryId === storyId) {
        setCoverStoryId('')
        setExistingCoverUrl(highlight?.coverUrl || '')
      }
      setSelectedIds((current) => current.filter((id) => id !== storyId))
    } else {
      setSelectedIds((current) => [...current, storyId])
    }
    setError('')
  }

  function moveSelectedStory(storyId, direction) {
    setSelectedIds((current) => {
      const index = current.indexOf(storyId)
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const reordered = [...current]
      ;[reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]]
      return reordered
    })
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (storyLoadError) {
      setError(storyLoadError)
      return
    }
    if (!title.trim()) {
      setError('Add a title for your Highlight.')
      return
    }
    if (!highlight?.id && !selectedIds.length) {
      setError('Choose at least one story to create a Highlight.')
      return
    }
    if (!hasCoverImage) {
      setError('Choose an image story or upload an image for the cover.')
      return
    }
    if (title.trim().length > 32) {
      setError('Highlight titles can contain up to 32 characters.')
      return
    }
    setSaving(true)
    try {
      let coverMedia
      if (coverFile) {
        const uploaded = await uploadMedia(coverFile)
        coverMedia = {
          url: uploaded.url,
          assetId: uploaded.assetId,
          mediaType: uploaded.resourceType,
          contentType: uploaded.mimeType,
          bytes: uploaded.bytes,
        }
      }
      const payload = {
        title: title.trim(),
        storyIds: selectedIds,
        ...((coverStoryId || (!existingCoverUrl && !coverFile && defaultCover?.type === 'image'))
          ? { coverStoryId: coverStoryId || defaultCover.id }
          : {}),
        ...(coverMedia ? { coverMedia } : {}),
      }
      const result = highlight?.id
        ? await updateHighlight(highlight.id, payload)
        : await createHighlight(payload)
      onSave(result.highlight)
    } catch (saveError) {
      setError(saveError.message || 'The Highlight could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!highlight?.id || !window.confirm(`Delete “${highlight.title}”? This cannot be undone.`)) return
    setDeleting(true)
    setError('')
    try {
      await deleteHighlight(highlight.id)
      onDelete(highlight.id)
    } catch (deleteError) {
      setError(deleteError.message || 'The Highlight could not be deleted.')
      setDeleting(false)
    }
  }

  return (
    <>
      {createPortal(
        <div className="profile-modal-backdrop profile-highlight-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
          <section className="profile-modal profile-highlight-editor" role="dialog" aria-modal="true" aria-labelledby="profile-highlight-editor-title">
            <div className="profile-modal__heading">
              <h2 id="profile-highlight-editor-title">{highlight?.id ? 'Edit Highlight' : 'Create Highlight'}</h2>
              <button type="button" className="profile-icon-button" aria-label="Close Highlight editor" onClick={onClose}><Icon name="close" size={18} /></button>
            </div>
            {loading ? <p className="profile-highlight__status" role="status">Loading your stories…</p> : (
              <form onSubmit={submit}>
            <label className="profile-field">Highlight title
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={32} placeholder="A little collection" autoFocus />
              <small className="profile-field__count">{title.length}/32</small>
            </label>
            {stories.length > 0 && <>
              <div className="profile-highlight__picker-heading">
                <div><strong>Choose stories</strong><small>Select several; reorder them below.</small></div>
                <span>{selectedIds.length} selected</span>
              </div>
              <div className="profile-highlight__story-picker">
                {stories.map((story) => (
                  <label className={`profile-highlight__story-option${selectedIds.includes(story.id) ? ' is-selected' : ''}`} key={story.id}>
                    {story.type === 'video'
                      ? <video src={story.media} muted playsInline preload="metadata" aria-hidden="true" />
                      : <img src={story.media} alt="" loading="lazy" />}
                    <span className="profile-highlight__story-check" aria-hidden="true">{selectedIds.includes(story.id) ? '✓' : ''}</span>
                    <input type="checkbox" checked={selectedIds.includes(story.id)} onChange={() => toggleStory(story.id)} aria-label={`Add story from ${new Date(story.createdAt).toLocaleDateString()}`} />
                    <small>{new Date(story.createdAt).toLocaleDateString()}</small>
                    {story.type === 'video' && <i aria-label="Video">▶</i>}
                  </label>
                ))}
              </div>
              {selectedStories.length > 0 && <div className="profile-highlight__selected">
                <strong>Story order</strong>
                {selectedStories.map((story, index) => (
                  <div className="profile-highlight__selected-story" key={story.id}>
                    <span>{index + 1}. {story.caption || new Date(story.createdAt).toLocaleString()}</span>
                    <div>
                      <button type="button" aria-label={`Move story ${index + 1} earlier`} disabled={index === 0} onClick={() => moveSelectedStory(story.id, -1)}>Earlier</button>
                      <button type="button" aria-label={`Move story ${index + 1} later`} disabled={index === selectedStories.length - 1} onClick={() => moveSelectedStory(story.id, 1)}>Later</button>
                    </div>
                  </div>
                ))}
              </div>}
              <div className="profile-highlight__cover-editor">
                <div className="profile-highlight__cover-preview">
                  {previewUrl
                    ? previewType === 'video'
                      ? <video src={previewUrl} muted playsInline preload="metadata" aria-label="Highlight cover preview" />
                      : <img src={previewUrl} alt="Highlight cover preview" />
                    : <span><Icon name="image" size={21} />Cover</span>}
                </div>
                <div className="profile-highlight__cover-actions">
                  <strong>Cover image</strong>
                  <small>Use a selected story or upload an image.</small>
                  <label className="profile-secondary-button profile-highlight__upload">
                    Upload image
                    <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) {
                        setCoverFile(file)
                        setCoverStoryId('')
                        setExistingCoverUrl('')
                        setError('')
                      }
                    }} />
                  </label>
                  {coverFile && <button type="button" className="profile-highlight__clear-cover" onClick={() => { setCoverFile(null); if (coverInputRef.current) coverInputRef.current.value = '' }}>Remove uploaded cover</button>}
                </div>
                {selectedStories.some((story) => story.type === 'image') && <label className="profile-field profile-highlight__cover-choice">Or choose a selected image story
                  <select value={coverStoryId} onChange={(event) => { setCoverStoryId(event.target.value); setCoverFile(null); setExistingCoverUrl('') }}>
                    <option value="">Use first selected story</option>
                    {selectedStories.filter((story) => story.type === 'image').map((story) => <option key={story.id} value={story.id}>Story {selectedIds.indexOf(story.id) + 1}</option>)}
                  </select>
                </label>}
                {!hasCoverImage && <p className="profile-highlight__status">Upload an image cover because this selection has no image story.</p>}
              </div>
              <div className="profile-highlight__final-preview" aria-label="Highlight preview">
                {previewUrl
                  ? previewType === 'video'
                    ? <video src={previewUrl} muted playsInline preload="metadata" aria-hidden="true" />
                    : <img src={previewUrl} alt="" />
                  : <span><Icon name="add" size={18} /></span>}
                <strong>{title.trim() || 'Your Highlight'}</strong>
                <button type="button" className="profile-highlight__preview-button" disabled={!selectedStories.length} onClick={() => setPreviewing(true)}>Preview</button>
              </div>
            </>}
            {stories.length === 0 && highlight?.id && <div className="profile-highlight__cover-editor">
              <div className="profile-highlight__cover-preview">
                {previewUrl
                  ? <img src={previewUrl} alt="Highlight cover preview" />
                  : <span><Icon name="image" size={21} />Cover</span>}
              </div>
              <div className="profile-highlight__cover-actions">
                <strong>Cover image</strong>
                <small>Upload a new image cover if needed.</small>
                <label className="profile-secondary-button profile-highlight__upload">
                  Upload image
                  <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                      setCoverFile(file)
                      setExistingCoverUrl('')
                      setError('')
                    }
                  }} />
                </label>
              </div>
            </div>}
            {stories.length === 0 && highlight?.id && <div className="profile-highlight__final-preview">
              {previewUrl
                ? <img src={previewUrl} alt="" />
                : <span><Icon name="add" size={18} /></span>}
              <strong>{title.trim() || 'Your Highlight'}</strong>
            </div>}
            {error && <p className={`profile-highlight__status${stories.length ? '' : ' is-error'}`} role="alert">{error}</p>}
            {storyLoadError && <button type="button" className="profile-highlight__retry" onClick={() => setReloadCount((count) => count + 1)}>Retry loading stories</button>}
            <div className="profile-modal__actions profile-highlight__actions">
              {highlight?.id && <button className="profile-secondary-button profile-highlight__delete" type="button" onClick={remove} disabled={deleting || saving}>{deleting ? 'Deleting…' : 'Delete Highlight'}</button>}
              <span />
              <button className="profile-secondary-button" type="button" onClick={onClose} disabled={saving || deleting}>Cancel</button>
              <button className="profile-primary-button" type="submit" disabled={loading || saving || deleting || Boolean(storyLoadError) || (!highlight?.id && !stories.length) || !hasCoverImage || (!highlight?.id && !selectedIds.length)}>{saving ? 'Saving…' : 'Save Highlight'}</button>
            </div>
              </form>
            )}
          </section>
        </div>,
        document.body,
      )}
      {previewing && <HighlightViewer
        state={{
          highlight: {
            id: highlight?.id || 'preview',
            title: title.trim() || 'Your Highlight',
            coverUrl: previewUrl,
            coverType: previewType,
            items: selectedStories,
            owner: profile,
          },
          profile,
          loading: false,
          error: '',
        }}
        onClose={() => setPreviewing(false)}
      />}
    </>
  )
}

function useObjectUrl(file) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!file) {
      setUrl('')
      return undefined
    }
    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])
  return url
}

function HighlightViewer({ state, onClose }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [progress, setProgress] = useState(0)
  const videoRef = useRef(null)
  const touchStart = useRef(null)
  const items = state.highlight?.items || []
  const item = items[index]
  const owner = state.highlight?.owner || state.profile

  useEffect(() => {
    if (state.loading || state.error || !items.length) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') setIndex((current) => Math.min(current + 1, items.length - 1))
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(current - 1, 0))
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [items.length, onClose, state.error, state.loading])

  useEffect(() => {
    if (!item) return undefined
    setLoaded(false)
    setMediaError(false)
    setProgress(0)
    setPaused(false)
    return undefined
  }, [item?.id])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  useEffect(() => {
    if (!item || item.type === 'video' || paused || !loaded) return undefined
    const duration = mediaError ? 2200 : 6000
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const percent = Math.min(((Date.now() - startedAt) / duration) * 100, 100)
      setProgress(percent)
      if (percent >= 100) {
        window.clearInterval(timer)
        if (index < items.length - 1) setIndex(index + 1)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [index, item, items.length, loaded, mediaError, paused])

  function goTo(nextIndex) {
    setIndex(Math.max(0, Math.min(nextIndex, items.length - 1)))
  }

  function togglePlayback() {
    if (item?.type === 'video' && videoRef.current) {
      if (paused) videoRef.current.play().catch((error) => console.error('Unable to resume highlight playback.', error))
      else videoRef.current.pause()
    }
    setPaused((current) => !current)
  }

  function setFailure() {
    setMediaError(true)
    setLoaded(true)
  }

  function handleTouchEnd(event) {
    if (touchStart.current == null) return
    const distance = event.changedTouches[0].clientX - touchStart.current
    if (Math.abs(distance) > 45) goTo(index + (distance < 0 ? 1 : -1))
    touchStart.current = null
  }

  return createPortal(
    <div className="profile-highlight-viewer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="profile-highlight-viewer" role="dialog" aria-modal="true" aria-label={`${state.highlight?.title || 'Highlight'} by ${owner?.name || 'profile owner'}`} onTouchStart={(event) => { touchStart.current = event.touches[0].clientX }} onTouchEnd={handleTouchEnd}>
        <button type="button" className="profile-highlight-viewer__close" aria-label="Close Highlight" onClick={onClose}><Icon name="close" size={20} /></button>
        {state.loading ? <div className="profile-highlight-viewer__message" role="status"><span className="profile-highlight-spinner" />Loading Highlight…</div>
          : state.error ? <div className="profile-highlight-viewer__message" role="alert"><Icon name="privacy" size={24} /><p>{state.error}</p><button type="button" onClick={onClose}>Close</button></div>
            : !items.length ? <div className="profile-highlight-viewer__message"><Icon name="image" size={24} /><p>This Highlight has no available stories.</p><button type="button" onClick={onClose}>Close</button></div>
              : <>
                <header className="profile-highlight-viewer__header">
                  <HighlightCover highlight={state.highlight} className="is-small" />
                  <span><strong>{state.highlight.title}</strong><small>{owner?.name} · @{owner?.username}</small></span>
                </header>
                <div className="profile-highlight-viewer__progress" aria-label={`Story ${index + 1} of ${items.length}`}>
                  {items.map((story, storyIndex) => <span key={story.id}><i style={{ transform: `scaleX(${storyIndex < index ? 1 : storyIndex === index ? progress / 100 : 0})`, transition: story.type === 'video' ? 'transform 100ms linear' : 'none' }} /></span>)}
                </div>
                <div className="profile-highlight-viewer__stage">
                  {!loaded && <span className="profile-highlight-spinner profile-highlight-viewer__loading" role="status" aria-label="Loading story" />}
                  {mediaError
                    ? <div className="profile-highlight-viewer__media-error" role="status"><Icon name="image" size={25} /><p>This story could not be loaded.</p><button type="button" onClick={() => goTo(index + 1)} disabled={index >= items.length - 1}>Continue</button></div>
                    : item.type === 'video'
                      ? <video ref={videoRef} key={item.id} src={item.media} className="profile-highlight-viewer__media" autoPlay muted={muted} playsInline onLoadedData={() => setLoaded(true)} onTimeUpdate={(event) => {
                        const video = event.currentTarget
                        setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0)
                      }} onEnded={() => goTo(index + 1)} onError={setFailure} />
                      : <img key={item.id} className="profile-highlight-viewer__media" src={item.media} alt={item.caption || `Story ${index + 1} from ${owner?.name}`} onLoad={() => setLoaded(true)} onError={setFailure} />}
                  {item.type === 'video' && !mediaError && <div className="profile-highlight-viewer__controls">
                    <button type="button" aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={() => setMuted((current) => !current)}><Icon name={muted ? 'mute' : 'volume'} size={18} /></button>
                    <button type="button" aria-label={paused ? 'Play video' : 'Pause video'} onClick={togglePlayback}><Icon name={paused ? 'play' : 'pause'} size={18} /></button>
                  </div>}
                  {item.caption && <p className="profile-highlight-viewer__caption">{item.caption}</p>}
                </div>
                <button className="profile-highlight-viewer__nav is-previous" type="button" aria-label="Previous story" onClick={() => goTo(index - 1)} disabled={index === 0}>‹</button>
                <button className="profile-highlight-viewer__nav is-next" type="button" aria-label="Next story" onClick={() => goTo(index + 1)} disabled={index === items.length - 1}>›</button>
                <span className="profile-highlight-viewer__counter">{index + 1} / {items.length}</span>
              </>}
      </section>
    </div>,
    document.body,
  )
}

export default function ProfileHighlights({ profile, isOwner, usesApi, onHighlightsChange }) {
  const [highlights, setHighlights] = useState(profile.highlights || [])
  const [editing, setEditing] = useState(undefined)
  const [viewer, setViewer] = useState(null)
  const [reordering, setReordering] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const viewerRequestId = useRef(0)

  useEffect(() => {
    setHighlights(profile.highlights || [])
  }, [profile.id, profile.highlights])

  useEffect(() => {
    viewerRequestId.current += 1
    setViewer(null)
    setEditing(undefined)
    setNotice('')
  }, [profile.id])

  function updateHighlights(nextHighlights) {
    setHighlights(nextHighlights)
    onHighlightsChange?.(nextHighlights)
  }

  function saveHighlight(saved) {
    const wasExisting = highlights.some(({ id }) => id === saved.id)
    const next = saved.displayOrder == null
      ? [...highlights, saved]
      : [...highlights.filter(({ id }) => id !== saved.id), saved]
    next.sort((first, second) => first.displayOrder - second.displayOrder)
    updateHighlights(next)
    setNotice(wasExisting ? 'Highlight updated.' : 'Highlight created.')
    setEditing(undefined)
  }

  function deleteSavedHighlight(id) {
    updateHighlights(highlights.filter((highlight) => highlight.id !== id))
    setNotice('Highlight deleted.')
    setEditing(undefined)
  }

  async function moveHighlight(index, direction) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= highlights.length || reordering) return
    const next = [...highlights]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    setReordering(true)
    setError('')
    setNotice('')
    try {
      await reorderHighlights(next.map(({ id }) => id))
      updateHighlights(next.map((highlight, displayOrder) => ({ ...highlight, displayOrder })))
      setNotice('Highlight order updated.')
    } catch (requestError) {
      setError(requestError.message || 'Highlight order could not be saved.')
    } finally {
      setReordering(false)
    }
  }

  async function openHighlight(highlight) {
    const requestId = ++viewerRequestId.current
    setViewer({ highlight, profile, loading: true, error: '' })
    try {
      const result = await getHighlight(highlight.id)
      if (viewerRequestId.current === requestId) setViewer({ highlight: result.highlight, profile, loading: false, error: '' })
    } catch (requestError) {
      if (viewerRequestId.current === requestId) setViewer({ highlight, profile, loading: false, error: requestError.message || 'This Highlight could not be opened.' })
    }
  }

  function closeViewer() {
    viewerRequestId.current += 1
    setViewer(null)
  }

  return (
    <section className="profile-highlights" aria-label="Profile Highlights">
      <div className="profile-highlights__heading">
        <div><h2>Highlights</h2></div>
        {isOwner && <button type="button" className="profile-highlight-create" onClick={() => { setError(''); setNotice(''); setEditing(null) }}><Icon name="add" size={17} />Create Highlight</button>}
      </div>
      {notice && <p className="profile-highlight__notice" role="status">{notice}<button type="button" aria-label="Dismiss Highlight message" onClick={() => setNotice('')}><Icon name="close" size={13} /></button></p>}
      {error && <p className="profile-highlight__inline-error" role="alert">{error}</p>}
      {highlights.length ? <div className="profile-highlight-list">
        {highlights.map((highlight, index) => (
          <div className="profile-highlight-card" key={highlight.id}>
            <button type="button" className="profile-highlight-card__open" aria-label={`Open ${highlight.title} Highlight`} onClick={() => openHighlight(highlight)}>
              <HighlightCover highlight={highlight} />
              <strong>{highlight.title}</strong>
            </button>
            {isOwner && <div className="profile-highlight-card__actions">
              <button type="button" aria-label={`Edit ${highlight.title}`} onClick={() => { setError(''); setNotice(''); setEditing(highlight) }}>Edit</button>
              <button type="button" aria-label={`Move ${highlight.title} earlier`} disabled={!index || reordering} onClick={() => moveHighlight(index, -1)}>↑</button>
              <button type="button" aria-label={`Move ${highlight.title} later`} disabled={index === highlights.length - 1 || reordering} onClick={() => moveHighlight(index, 1)}>↓</button>
            </div>}
          </div>
        ))}
      </div> : <p className="profile-highlights__empty">{isOwner ? 'Save your favorite stories in a Highlight to keep them on your profile.' : 'No Highlights yet.'}</p>}
      {editing !== undefined && <HighlightEditor
        highlight={editing}
        profile={profile}
        usesApi={usesApi}
        onClose={() => setEditing(undefined)}
        onSave={saveHighlight}
        onDelete={deleteSavedHighlight}
      />}
      {viewer && <HighlightViewer state={viewer} onClose={closeViewer} />}
    </section>
  )
}
