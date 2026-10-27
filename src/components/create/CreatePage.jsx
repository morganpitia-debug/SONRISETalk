import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { createPost, createStory, uploadMedia } from '../../api/social.js'
import { isApiEnabled } from '../../api/auth.js'

const formats = [
  { id: 'Post', description: 'Share a photo or a thought.', icon: 'image' },
  { id: 'Reel', description: 'Make a short video moment.', icon: 'play' },
  { id: 'Story', description: 'Share something that lasts a day.', icon: 'story' },
]

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Selected media could not be read.'))
    reader.readAsDataURL(file)
  })
}

function formatVideoTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.floor(seconds) : 0
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function CreateVideoPreview({ src, label }) {
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackError, setPlaybackError] = useState('')

  useEffect(() => {
    setPlaying(false)
    setMuted(true)
    setProgress(0)
    setDuration(0)
    setPlaybackError('')
    videoRef.current?.load()
  }, [src])

  async function togglePlayback() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      try {
        await video.play()
        setPlaying(true)
      } catch (error) {
        setPlaybackError(error.message || 'This video could not be played.')
      }
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  function seekVideo(event) {
    const video = videoRef.current
    if (!video || !video.duration) return
    const nextProgress = Number(event.currentTarget.value)
    video.currentTime = (nextProgress / 100) * video.duration
    setProgress(nextProgress)
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }

  async function enterFullscreen() {
    try {
      await videoRef.current?.requestFullscreen?.()
    } catch (error) {
      setPlaybackError(error.message || 'This video could not open in fullscreen.')
    }
  }

  return (
    <div className="create-video-frame">
      <video
        ref={videoRef}
        src={src}
        muted={muted}
        playsInline
        preload="auto"
        aria-label={label}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setPlaybackError('This video could not be played. Try an MP4 encoded with H.264 or a WebM video.')}
      />
      <span className="create-video-frame__badge"><i /> VIDEO PREVIEW</span>
      {playbackError && <p className="create-video-frame__error" role="alert">{playbackError}</p>}
      <div className="create-video-frame__controls">
        <button type="button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={togglePlayback}><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
        <span className="create-video-frame__time">{formatVideoTime((progress / 100) * duration)}</span>
        <input
          type="range"
          aria-label="Video progress"
          min="0"
          max="100"
          value={Math.round(progress)}
          style={{ '--video-progress': `${progress}%` }}
          onChange={seekVideo}
        />
        <button type="button" aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={toggleMute}><Icon name={muted ? 'mute' : 'volume'} size={16} /></button>
        <button type="button" aria-label="View fullscreen" onClick={enterFullscreen}><span aria-hidden="true">⛶</span></button>
      </div>
    </div>
  )
}

function CameraCapture({ format, caption, onClose, onPost }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const [stream, setStream] = useState(null)
  const [preview, setPreview] = useState(null)
  const [reviewFormat, setReviewFormat] = useState(format)
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [flashOn, setFlashOn] = useState(false)
  const [flashAvailable, setFlashAvailable] = useState(false)
  const [switchingCamera, setSwitchingCamera] = useState(false)
  const [cameraMode, setCameraMode] = useState(format === 'Reel' ? 'video' : 'photo')
  const [facingMode, setFacingMode] = useState('user')
  const [focusPoint, setFocusPoint] = useState(null)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [error, setError] = useState('')
  const pickerRef = useRef(null)
  const previewUrl = useMemo(() => preview ? URL.createObjectURL(preview) : '', [preview])

  function reviewMedia(file) {
    setPreview(file)
    if (file.type.startsWith('image/') && reviewFormat === 'Reel') setReviewFormat('Post')
  }

  function stopCameraStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
  }

  async function requestCameraStream(facing, { exactFacing = false } = {}) {
    const video = { facingMode: { [exactFacing ? 'exact' : 'ideal']: facing } }
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch (audioError) {
      return navigator.mediaDevices.getUserMedia({ audio: false, video })
    }
  }

  useEffect(() => {
    let active = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext
        ? 'Camera access is not supported by this browser.'
        : 'Camera access requires a secure connection (HTTPS or localhost).')
      return () => { document.body.style.overflow = previousOverflow }
    }
    requestCameraStream('user')
      .then((cameraStream) => {
        if (!active) {
          cameraStream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = cameraStream
        setStream(cameraStream)
      })
      .catch((cameraError) => {
        if (active) setError(cameraError.name === 'NotAllowedError'
          ? 'Allow camera access in your browser to take a photo or record a video.'
          : cameraError.message || 'The camera could not be started.')
      })
    return () => {
      active = false
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.onstop = null
        recorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0)
      return undefined
    }
    if (paused) return undefined
    const timer = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording, paused])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream, preview])

  useEffect(() => {
    let available = false
    try {
      available = stream?.getVideoTracks()[0]?.getCapabilities?.().torch === true
    } catch {
      available = false
    }
    setFlashAvailable(available)
    if (!available) setFlashOn(false)
  }, [stream])

  async function switchCamera() {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user'
    const previousFacing = facingMode
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
    setFlashOn(false)
    setFlashAvailable(false)
    setSwitchingCamera(true)
    try {
      const nextStream = await requestCameraStream(nextFacing, { exactFacing: true })
      streamRef.current = nextStream
      setStream(nextStream)
      setFacingMode(nextFacing)
      setError('')
    } catch (switchError) {
      try {
        const restoredStream = await requestCameraStream(previousFacing)
        streamRef.current = restoredStream
        setStream(restoredStream)
        setError(switchError.message || 'The other camera could not be started.')
      } catch (restoreError) {
        setError(`${switchError.message || 'The other camera could not be started.'} ${restoreError.message || 'The previous camera could not be restarted.'}`)
      }
    } finally {
      setSwitchingCamera(false)
    }
  }

  function selectGalleryMedia(event) {
    const file = event.target.files?.[0]
    if (!file) return
    stopCameraStream()
    reviewMedia(file)
    setError('')
  }

  function focusCamera(event) {
    if (recording) return
    const bounds = event.currentTarget.getBoundingClientRect()
    setFocusPoint({
      x: `${((event.clientX - bounds.left) / bounds.width) * 100}%`,
      y: `${((event.clientY - bounds.top) / bounds.height) * 100}%`,
    })
    window.setTimeout(() => setFocusPoint(null), 900)
  }

  function takePhoto() {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) {
      setError('The camera is not ready yet. Try again in a moment.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('The photo could not be captured. Please try again.')
        return
      }
      stopCameraStream()
      reviewMedia(new File([blob], `sonrisetalk-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      setError('')
    }, 'image/jpeg', 0.92)
  }

  function startRecording(event) {
    event.preventDefault()
    if (!stream || preview) return
    if (recording) {
      stopRecording()
      return
    }
    if (!window.MediaRecorder) {
      setError('Video recording is not supported by this browser.')
      return
    }
    try {
      const mimeType = typeof MediaRecorder.isTypeSupported === 'function'
        ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
        : undefined
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (recordEvent) => {
        if (recordEvent.data.size) chunksRef.current.push(recordEvent.data)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || chunksRef.current.find((chunk) => chunk.type)?.type || 'video/webm'
        const videoFile = new File(chunksRef.current, `sonrisetalk-video-${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type })
        stopCameraStream()
        reviewMedia(videoFile)
        setRecording(false)
        setPaused(false)
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setPaused(false)
      setError('')
    } catch (recordError) {
      setError(recordError.message || 'Video recording could not be started.')
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    setRecording(false)
    setPaused(false)
  }

  function togglePause() {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'recording' && typeof recorder.pause === 'function') {
      recorder.pause()
      setPaused(true)
    } else if (recorder.state === 'paused' && typeof recorder.resume === 'function') {
      recorder.resume()
      setPaused(false)
    } else {
      setError('Pause is not supported by this browser.')
    }
  }

  async function toggleFlash() {
    const track = streamRef.current?.getVideoTracks()[0]
    const capabilities = track?.getCapabilities?.()
    if (!track || capabilities?.torch !== true) {
      setError('Flash is not available on this camera.')
      return
    }
    try {
      await track.applyConstraints({ advanced: [{ torch: !flashOn }] })
      setFlashOn(!flashOn)
      setError('')
    } catch (flashError) {
      setError(flashError.message || 'Flash could not be changed.')
    }
  }

  function cancelPreview() {
    onClose()
  }

  return createPortal((
    <div className="create-camera" role="dialog" aria-modal="true" aria-label="Camera">
      {preview ? (
        <div className="create-camera__review">
          {preview.type.startsWith('video/')
            ? <CreateVideoPreview src={previewUrl} label="Review recorded video" />
            : <img src={previewUrl} alt="Review captured photo" />}
          <div className="create-camera__review-formats" role="group" aria-label="Share captured media as">
            {['Post', 'Reel', 'Story'].map((nextFormat) => {
              const disabled = nextFormat === 'Reel' && !preview.type.startsWith('video/')
              return (
                <button
                  type="button"
                  key={nextFormat}
                  className={reviewFormat === nextFormat ? 'is-selected' : ''}
                  aria-pressed={reviewFormat === nextFormat}
                  disabled={disabled}
                  onClick={() => setReviewFormat(nextFormat)}
                >
                  {nextFormat}
                </button>
              )
            })}
          </div>
          <div className="create-camera__review-caption">{caption || 'Ready to share'}</div>
          <div className="create-camera__review-actions">
            <button type="button" onClick={cancelPreview}>Cancel</button>
            <button type="button" onClick={() => onPost(preview, reviewFormat)}>Share {reviewFormat}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="create-camera__viewfinder" onClick={focusCamera}>
            {stream && <video ref={videoRef} className={`create-camera__live${facingMode === 'user' ? ' is-selfie' : ''}`} autoPlay muted playsInline aria-label="Live camera preview" />}
            {!stream && <div className="create-camera__placeholder"><Icon name="camera" size={32} /><span>Starting camera…</span></div>}
            {focusPoint && <span className="create-camera__focus" style={{ left: focusPoint.x, top: focusPoint.y }} />}
            <span className={`create-camera__reticle${focusPoint ? ' is-focused' : ''}`} aria-hidden="true" />
            {recording && <span className={`create-camera__recording${paused ? ' is-paused' : ''}`}><i /> {paused ? 'PAUSED' : 'REC'} {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</span>}
          </div>
          <button className="create-camera__close" type="button" onClick={onClose} aria-label="Close camera"><Icon name="close" size={22} /></button>
          <button className={`create-camera__flash${flashOn ? ' is-on' : ''}`} type="button" onClick={toggleFlash} disabled={!stream || !flashAvailable} title={flashAvailable ? (flashOn ? 'Turn flash off' : 'Turn flash on') : 'Flash is not available on this camera'} aria-label={flashAvailable ? (flashOn ? 'Turn flash off' : 'Turn flash on') : 'Flash is not available on this camera'}><Icon name="flash" size={20} /></button>
          {error && <p className="create-camera__error" role="alert">{error}</p>}
          <input ref={pickerRef} className="create-camera__gallery-input" type="file" accept="image/*,video/*" onChange={selectGalleryMedia} />
          <button className="create-camera__gallery" type="button" disabled={recording} onClick={() => pickerRef.current?.click()} aria-label="Choose from gallery"><Icon name="image" size={21} /></button>
          <button className="create-camera__switch" type="button" disabled={!stream || recording || switchingCamera} onClick={switchCamera} aria-label={facingMode === 'user' ? 'Switch to rear camera' : 'Switch to front camera'} title={facingMode === 'user' ? 'Switch to rear camera' : 'Switch to front camera'}><Icon name="switch-camera" size={21} /></button>
          {cameraMode === 'video' ? (
            <button
              className={`create-camera__shutter create-camera__shutter--record${recording ? ' is-recording' : ''}`}
              type="button"
              disabled={!stream}
              onClick={startRecording}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
            ><span /></button>
          ) : (
            <button className="create-camera__shutter" type="button" disabled={!stream} onClick={takePhoto} aria-label="Take photo"><span /></button>
          )}
          {recording && (
            <button className="create-camera__pause" type="button" onClick={togglePause} aria-label={paused ? 'Resume recording' : 'Pause recording'}>
              <Icon name={paused ? 'play' : 'pause'} size={19} />
            </button>
          )}
          {(format === 'Story' || format === 'Reel' || format === 'Post') && (
            <div className="create-camera__modes" aria-label="Camera mode">
              {['photo', 'video'].map((mode) => <button className={cameraMode === mode ? 'is-selected' : ''} type="button" key={mode} onClick={() => { if (!recording) setCameraMode(mode) }}>{mode.toUpperCase()}</button>)}
            </div>
          )}
        </>
      )}
    </div>
  ), document.body)
}

export default function CreatePage({ initialFormat = 'Post', onNavigate, onCreate, currentUser = {} }) {
  const usesApi = isApiEnabled()
  const [format, setFormat] = useState(initialFormat)
  const [caption, setCaption] = useState('')
  const [media, setMedia] = useState(null)
  const [created, setCreated] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const mediaUrl = useMemo(() => media ? URL.createObjectURL(media) : '', [media])

  useEffect(() => () => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
  }, [mediaUrl])

  async function shareMedia(selectedMedia = media, selectedFormat = format) {
    if (!caption.trim() && !selectedMedia) return
    if (selectedFormat === 'Reel' && !selectedMedia?.type.startsWith('video/')) {
      setSubmitError('Choose a video to share a reel.')
      return
    }
    if (selectedFormat === 'Story' && !selectedMedia) {
      setSubmitError('Choose an image or video to share a story.')
      return
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      if (usesApi) {
        let uploadedMedia = []
        if (selectedMedia) {
          const uploaded = await uploadMedia(selectedMedia)
          const expectedResourceType = selectedMedia.type.startsWith('video/') ? 'video' : 'image'
          if (!uploaded?.url || !uploaded.assetId || uploaded.resourceType !== expectedResourceType || !uploaded.mimeType) {
            throw new Error('The media upload was not confirmed. Your content has not been shared.')
          }
          uploadedMedia = [{
            url: uploaded.url,
            assetId: uploaded.assetId,
            mediaType: uploaded.resourceType,
            contentType: uploaded.mimeType,
            bytes: uploaded.bytes,
          }]
        }
        if (selectedFormat === 'Story') {
          if (!uploadedMedia.length) throw new Error('Choose an image or video for your story.')
          const result = await createStory({ media: uploadedMedia[0], caption: caption.trim() })
          if (!result?.data?.story?.id) {
            throw new Error('The server did not confirm your story. It has not been shared.')
          }
        } else {
          const result = await createPost({
            content: selectedFormat === 'Post' ? caption.trim() : '',
            caption: selectedFormat === 'Post' ? '' : caption.trim(),
            format: selectedFormat,
            media: uploadedMedia,
          })
          if (!result?.data?.post?.id) {
            throw new Error(`The server did not confirm your ${selectedFormat.toLowerCase()}. It has not been shared.`)
          }
        }
      } else {
        if (!onCreate) throw new Error('Publishing is unavailable because the content service is not configured.')
        const mediaData = selectedMedia ? await readFileAsDataUrl(selectedMedia) : ''
        const id = `local-${Date.now()}`
        if (selectedFormat === 'Story') {
          onCreate?.({
            kind: 'story',
            item: {
              id,
              own: true,
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              name: currentUser.name || 'You',
              initials: currentUser.initials || '',
              tone: 'amber',
              type: selectedMedia?.type.startsWith('video/') ? 'video' : 'photo',
              media: mediaData,
              caption: caption.trim(),
              profilePicture: null,
            },
          })
        } else {
          onCreate?.({
            kind: 'post',
            item: {
              id,
              type: selectedFormat === 'Reel' ? 'reel' : selectedMedia?.type.startsWith('video/') ? 'video' : selectedMedia ? 'image' : 'text',
              format: selectedFormat,
              media: mediaData || undefined,
              mediaName: selectedMedia?.name || '',
              author: currentUser.name || 'You',
              handle: currentUser.username || '',
              profileId: currentUser.id || '',
              initials: currentUser.initials || '',
              tone: 'amber',
              context: `A new ${selectedFormat.toLowerCase()} from you`,
              time: 'Just now',
              title: caption.trim() || selectedMedia?.name || `A new ${selectedFormat.toLowerCase()}`,
              body: caption.trim(),
              replies: 0,
              resonated: 0,
              comments: [],
            },
          })
        }
      }
      setCreated({
        format: selectedFormat,
        caption: caption.trim(),
        mediaName: selectedMedia?.name || '',
        localOnly: !usesApi,
      })
      setCaption('')
      setMedia(null)
      if (format === 'Story') setFormat('Story')
    } catch (error) {
      setSubmitError(error.message || `Your ${selectedFormat.toLowerCase()} could not be shared.`)
    } finally {
      setSubmitting(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    await shareMedia()
  }

  async function postCapturedMedia(capturedMedia, selectedFormat) {
    setMedia(capturedMedia)
    setCameraOpen(false)
    setFormat(selectedFormat)
    await shareMedia(capturedMedia, selectedFormat)
  }

  function chooseFormat(nextFormat) {
    setFormat(nextFormat)
    setCreated(null)
    setMedia(null)
  }

  const acceptedMedia = format === 'Reel' ? 'video/*' : 'image/*,video/*'
  const readyToShare = format === 'Story'
    ? Boolean(media)
    : format === 'Reel'
      ? Boolean(media?.type.startsWith('video/'))
      : Boolean(caption.trim() || media)

  return (
    <div className="create-page">
      <header className="create-page__header">
        <span className="create-eyebrow"><span /> MAKE IT YOURS</span>
        <h1>Create</h1>
      </header>

      <div className="create-format-list" role="tablist" aria-label="Choose content format">
        {formats.map((item) => (
          <button
            className={`create-format${format === item.id ? ' is-selected' : ''}`}
            type="button"
            role="tab"
            aria-selected={format === item.id}
            key={item.id}
            onClick={() => chooseFormat(item.id)}
          >
            <span className="create-format__icon"><Icon name={item.icon} size={19} /></span>
            <span className="create-format__copy"><strong>{item.id}</strong><small>{item.description}</small></span>
            <span className="create-format__signal" />
          </button>
        ))}
      </div>

      <form className="create-composer" onSubmit={submit}>
        <div className="create-composer__heading">
          <div>
            <span className="create-eyebrow">{format.toUpperCase()}</span>
            <h2>{format === 'Post' ? 'Create a post' : format === 'Reel' ? 'Create a reel' : 'Create a story'}</h2>
          </div>
          <span className="create-composer__local">SHARE WITH YOUR WORLD</span>
        </div>

        <label className="create-caption-label" htmlFor="create-caption">Your caption</label>
        <textarea
          id="create-caption"
          value={caption}
          onChange={(event) => { setCaption(event.target.value); setCreated(null) }}
          placeholder={format === 'Post' ? 'What would you like to share?' : format === 'Reel' ? 'Add a thought to your reel...' : 'Add a little context...'}
          maxLength={500}
          rows={4}
        />
        <div className="create-composer__meta"><span>Preview your caption and media before sharing.</span><span>{caption.length}/500</span></div>

        <div className={`create-media-picker${media ? ' has-file' : ''}`}>
          <input id="create-media-file" type="file" accept={acceptedMedia} onChange={(event) => { setMedia(event.target.files?.[0] || null); setCreated(null) }} />
          <label htmlFor="create-media-file">
            <span className="create-media-picker__icon"><Icon name={media ? 'check' : 'add'} size={18} /></span>
            <span><strong>{media ? media.name : format === 'Post' ? 'Add a photo' : format === 'Reel' ? 'Add a video' : 'Add media'}</strong><small>{media ? 'Selected · uploads when you share' : format === 'Reel' ? 'Choose a video to create your reel' : 'Choose a file for your preview'}</small></span>
          </label>
          {media && <button className="create-media-picker__remove" type="button" aria-label="Remove selected media" onClick={() => { setMedia(null); setCreated(null) }}><Icon name="close" size={16} /></button>}
        </div>

        <div className="create-composer__actions">
          <span>Shared with the audience set on your account.</span>
          <div className="create-composer__buttons">
            <button className="create-composer__camera" type="button" onClick={() => { setSubmitError(''); setCameraOpen(true) }} aria-label="Open camera"><Icon name="camera" size={17} /></button>
            <button type="submit" disabled={submitting || !readyToShare}><Icon name="add" size={16} /> {submitting ? 'Sharing…' : `Share ${format.toLowerCase()}`}</button>
          </div>
        </div>
        {submitError && <p className="create-submit-error" role="alert">{submitError}</p>}
      </form>

      {created && (
        <section className="create-result" role="status" aria-live="polite">
          <span className="create-result__check"><Icon name="check" size={16} /></span>
          <div>
            <strong>{created.localOnly
              ? `Saved for this session only — not uploaded as a ${created.format.toLowerCase()}`
              : `Your ${created.format.toLowerCase()} was shared`}</strong>
            <small>{created.caption || created.mediaName}</small>
          </div>
          <button className="create-result__view" type="button" onClick={() => onNavigate?.('Home')}>View</button>
          <button type="button" aria-label="Dismiss preview message" onClick={() => setCreated(null)}><Icon name="close" size={16} /></button>
        </section>
      )}
      {mediaUrl && (
        <div className="create-media-preview">
          {media.type.startsWith('video/')
            ? <CreateVideoPreview src={mediaUrl} label="Selected video preview" />
            : <img src={mediaUrl} alt="Selected image preview" />}
          <button type="button" aria-label="Remove selected media" onClick={() => setMedia(null)}><Icon name="close" size={16} /></button>
        </div>
      )}
      {cameraOpen && <CameraCapture format={format} caption={caption.trim()} onClose={() => setCameraOpen(false)} onPost={postCapturedMedia} />}
    </div>
  )
}
