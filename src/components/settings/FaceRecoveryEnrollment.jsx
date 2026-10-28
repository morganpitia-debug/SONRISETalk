import { useCallback, useEffect, useState } from 'react'
import { enrollFaceRecovery, getFaceRecoveryStatus, removeFaceRecovery } from '../../api/auth.js'
import FaceChallenge from '../auth/FaceChallenge.jsx'

export default function FaceRecoveryEnrollment() {
  const [enabled, setEnabled] = useState(false)
  const [available, setAvailable] = useState(false)
  const [password, setPassword] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    getFaceRecoveryStatus()
      .then(({ data }) => {
        if (active) {
          setEnabled(data.enabled)
          setAvailable(data.available)
        }
      })
      .catch((error) => {
        if (active) setNotice(error.message || 'Face recovery status could not load.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const handleCancel = useCallback((reason) => {
    setCameraOpen(false)
    if (reason === 'timeout') setNotice('The smile check timed out. Try again when ready.')
    else if (reason === 'error') setNotice('The camera check could not start. Check camera access and try again.')
    else if (reason === 'capture-failed') setNotice('The camera frame could not be captured. Try again.')
  }, [])

  const handleCaptured = useCallback(async (frame) => {
    setCameraOpen(false)
    setSubmitting(true)
    setNotice('Checking your enrollment…')
    try {
      await enrollFaceRecovery(password, frame)
      setEnabled(true)
      setPassword('')
      setNotice('Face recovery is enabled. Your reference image is encrypted.')
      window.dispatchEvent(new CustomEvent('sonrisetalk-face-recovery-updated', { detail: { enabled: true } }))
    } catch (error) {
      setNotice(error.message || 'Face recovery could not be enabled.')
    } finally {
      setSubmitting(false)
    }
  }, [password])

  async function disableFaceRecovery() {
    setSubmitting(true)
    setNotice('')
    try {
      await removeFaceRecovery(password)
      setEnabled(false)
      setPassword('')
      setNotice('Face recovery is disabled and the encrypted reference has been deleted.')
    } catch (error) {
      setNotice(error.message || 'Face recovery could not be disabled.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="face-recovery-enrollment">
      <div className="settings-option-row">
        <span>
          <strong>Face recovery</strong>
          <small>{enabled ? 'An encrypted reference is enrolled for password recovery.' : 'Optional; requires your current password and camera access.'}</small>
        </span>
      </div>
      <p className="settings-section-intro">This stores an encrypted selfie and compares it during recovery. A smile challenge and face match are not reliable proof of identity or foolproof liveness detection; keep a passkey set up when possible.</p>
      {!loading && !available && <p className="settings-face-notice" role="status">Face recovery is not configured on the account service.</p>}
      {!cameraOpen && <label className="settings-face-password">
        <span>{enabled ? 'Confirm your current password to disable' : 'Confirm your current password'}</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>}
      {!loading && !cameraOpen && (enabled
        ? <button className="settings-danger-button" type="button" disabled={submitting || !password} onClick={disableFaceRecovery}>{submitting ? 'Updating…' : 'Disable face recovery'}</button>
        : <button className="settings-secondary-button" type="button" disabled={submitting || !password || !available} onClick={() => { setNotice(''); setCameraOpen(true) }}>{submitting ? 'Updating…' : 'Enroll face for recovery'}</button>)}
      {cameraOpen && <FaceChallenge onCaptured={handleCaptured} onCancel={handleCancel} />}
      {notice && <p className="settings-face-notice" role="status">{notice}</p>}
      {loading && <p className="settings-face-notice" role="status">Loading face recovery status…</p>}
    </div>
  )
}
