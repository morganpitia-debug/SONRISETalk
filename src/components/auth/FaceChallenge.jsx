import { useEffect, useRef, useState } from 'react'

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const VISION_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm'
const SMILE_THRESHOLD = 0.55
const CHALLENGE_DURATION_MS = 5_000

export default function FaceChallenge({ onCaptured, onCancel }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Allow camera access to start the smile check.')

  useEffect(() => {
    let active = true
    let stream
    let landmarker
    let animationFrame
    let timeout
    let observedNeutralExpression = false

    async function startChallenge() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        })
        if (!active) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        const video = videoRef.current
        video.srcObject = stream
        await video.play()
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
        const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL)
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
          outputFaceBlendshapes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
        })
        if (!active) {
          landmarker.close()
          return
        }

        setStatus('Relax your face, then smile. You have five seconds.')
        timeout = window.setTimeout(() => {
          if (!active) return
          onCancel('timeout')
        }, CHALLENGE_DURATION_MS)

        function detectFrame() {
          if (!active) return
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const result = landmarker.detectForVideo(video, performance.now())
            const categories = result.faceBlendshapes?.[0]?.categories ?? []
            const leftSmile = categories.find(({ categoryName }) => categoryName === 'mouthSmileLeft')?.score ?? 0
            const rightSmile = categories.find(({ categoryName }) => categoryName === 'mouthSmileRight')?.score ?? 0
            if (leftSmile < 0.25 && rightSmile < 0.25) observedNeutralExpression = true
            if (observedNeutralExpression && leftSmile > SMILE_THRESHOLD && rightSmile > SMILE_THRESHOLD) {
              window.clearTimeout(timeout)
              const canvas = canvasRef.current
              const scale = Math.min(1, 640 / video.videoWidth, 480 / video.videoHeight)
              canvas.width = Math.round(video.videoWidth * scale)
              canvas.height = Math.round(video.videoHeight * scale)
              const context = canvas.getContext('2d')
              if (!context) {
                onCancel('capture-failed')
                return
              }
              context.drawImage(video, 0, 0, canvas.width, canvas.height)
              canvas.toBlob((blob) => {
                if (!active) return
                if (blob) onCaptured(blob)
                else {
                  onCancel('capture-failed')
                }
              }, 'image/jpeg', 0.82)
              return
            }
          }
          animationFrame = window.requestAnimationFrame(detectFrame)
        }

        detectFrame()
      } catch {
        if (!active) return
        onCancel('error')
      }
    }

    startChallenge()
    return () => {
      active = false
      window.clearTimeout(timeout)
      window.cancelAnimationFrame(animationFrame)
      landmarker?.close()
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onCancel, onCaptured])

  return (
    <div className="face-challenge">
      <div className="face-challenge__camera">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview" />
        <div className="face-challenge__overlay" aria-hidden="true">
          <span className="face-challenge__oval" />
          <span className="face-challenge__scan-line" />
          <span className="face-challenge__corner face-challenge__corner--top-left" />
          <span className="face-challenge__corner face-challenge__corner--top-right" />
          <span className="face-challenge__corner face-challenge__corner--bottom-left" />
          <span className="face-challenge__corner face-challenge__corner--bottom-right" />
          <span className="face-challenge__camera-label">LIVE FACE CHECK</span>
        </div>
      </div>
      <canvas ref={canvasRef} hidden />
      <p role="status">{status}</p>
      <p className="face-challenge__warning">A smile check is not foolproof liveness detection. Use a passkey whenever possible.</p>
      <button className="auth-secondary" type="button" onClick={() => onCancel('cancelled')}>Cancel</button>
    </div>
  )
}
