import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { createRealtimeSocket, getIceServers } from '../api/messaging.js'

export const CallManagerContext = createContext(null)

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (error, result) => {
      if (error) {
        reject(new Error('The call server did not respond. Check your connection and try again.'))
      } else if (result?.error) {
        reject(new Error(result.error.message || 'The call request failed.'))
      } else {
        resolve(result?.data)
      }
    })
  })
}

export default function useCallManager(enabled) {
  const [call, setCall] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [muted, setMuted] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [callError, setCallError] = useState('')
  const socketRef = useRef(null)
  const callRef = useRef(null)
  const peerRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteStreamRef = useRef(null)
  const candidateQueueRef = useRef([])
  const recoveryTimerRef = useRef(null)
  const recoveryAttemptsRef = useRef(0)

  const updateCall = useCallback((next) => {
    const value = typeof next === 'function' ? next(callRef.current) : next
    callRef.current = value
    setCall(value)
  }, [])

  const cleanupMedia = useCallback(() => {
    if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current)
    recoveryTimerRef.current = null
    recoveryAttemptsRef.current = 0
    peerRef.current?.close()
    peerRef.current = null
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop())
    remoteStreamRef.current = null
    candidateQueueRef.current = []
    setLocalStream(null)
    setRemoteStream(null)
    setMuted(false)
    setCameraEnabled(true)
  }, [])

  const sendSignal = useCallback(async (callId, signal) => {
    const socket = socketRef.current
    if (!socket?.connected) throw new Error('Call signaling disconnected. Reconnect and try again.')
    await emitAck(socket, 'call:signal', { callId, signal })
  }, [])

  const endCall = useCallback(async (status = 'completed') => {
    const activeCall = callRef.current
    if (!activeCall) return
    const socket = socketRef.current
    try {
      if (socket?.connected) await emitAck(socket, 'call:end', { callId: activeCall.id, status })
    } catch (error) {
      setCallError(error.message)
    } finally {
      cleanupMedia()
      updateCall(null)
    }
  }, [cleanupMedia, updateCall])

  const createPeer = useCallback(async (activeCall) => {
    if (peerRef.current) return peerRef.current
    const { iceServers } = await getIceServers()
    const peer = new RTCPeerConnection({ iceServers })
    peerRef.current = peer
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      peer.addTrack(track, localStreamRef.current)
    }
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? remoteStreamRef.current ?? new MediaStream()
      if (!event.streams[0]) stream.addTrack(event.track)
      remoteStreamRef.current = stream
      setRemoteStream(stream)
    }
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(activeCall.id, { type: 'candidate', candidate: event.candidate.toJSON() })
          .catch((error) => setCallError(error.message))
      }
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
        recoveryAttemptsRef.current = 0
        updateCall((callRef.current && { ...callRef.current, phase: 'active' }) || null)
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        updateCall((callRef.current && { ...callRef.current, phase: 'reconnecting' }) || null)
        if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = window.setTimeout(async () => {
          if (peer.connectionState === 'connected') return
          if (!activeCall.initiator || recoveryAttemptsRef.current >= 2) {
            endCall('failed')
            return
          }
          recoveryAttemptsRef.current += 1
          try {
            const offer = await peer.createOffer({ iceRestart: true })
            await peer.setLocalDescription(offer)
            await sendSignal(activeCall.id, { type: 'description', description: peer.localDescription })
          } catch (error) {
            setCallError(error.message || 'The call connection could not be recovered.')
            endCall('failed')
          }
        }, peer.connectionState === 'failed' ? 1500 : 10000)
      } else if (peer.connectionState === 'closed') {
        updateCall((callRef.current && { ...callRef.current, phase: 'reconnecting' }) || null)
      }
    }
    return peer
  }, [endCall, sendSignal, updateCall])

  const handleSignal = useCallback(async ({ callId, signal }) => {
    const activeCall = callRef.current
    if (!activeCall || activeCall.id !== callId) return
    try {
      const peer = await createPeer(activeCall)
      if (signal.type === 'candidate') {
        if (!signal.candidate) return
        if (!peer.remoteDescription) candidateQueueRef.current.push(signal.candidate)
        else await peer.addIceCandidate(signal.candidate)
        return
      }
      await peer.setRemoteDescription(signal.description)
      for (const candidate of candidateQueueRef.current.splice(0)) await peer.addIceCandidate(candidate)
      if (signal.description.type === 'offer') {
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        await sendSignal(activeCall.id, { type: 'description', description: peer.localDescription })
      }
    } catch (error) {
      setCallError(error.message || 'Call negotiation failed.')
      endCall('failed')
    }
  }, [createPeer, endCall, sendSignal])

  useEffect(() => {
    if (!enabled) return undefined
    let mounted = true
    let socket
    createRealtimeSocket().then((connection) => {
      if (!mounted) {
        connection.disconnect()
        return
      }
      socket = connection
      socketRef.current = connection
      connection.on('call:incoming', (incomingCall) => {
        if (callRef.current) {
          emitAck(connection, 'call:end', { callId: incomingCall.id, status: 'declined' }).catch((error) => setCallError(error.message))
          return
        }
        updateCall({
          ...incomingCall,
          phase: 'incoming',
          initiator: false,
          peerName: incomingCall.caller?.name || 'Someone',
          peerProfilePicture: incomingCall.caller?.profilePicture || null,
        })
      })
      connection.on('call:accepted', async ({ callId, acceptedAt }) => {
        const activeCall = callRef.current
        if (!activeCall || activeCall.id !== callId) return
        updateCall({ ...activeCall, phase: 'connecting', acceptedAt })
        try {
          const peer = await createPeer(activeCall)
          const offer = await peer.createOffer()
          await peer.setLocalDescription(offer)
          await sendSignal(callId, { type: 'description', description: peer.localDescription })
        } catch (error) {
          setCallError(error.message || 'The call could not connect.')
          endCall('failed')
        }
      })
      connection.on('call:signal', handleSignal)
      connection.on('call:ended', ({ callId, status }) => {
        if (callRef.current?.id !== callId) return
        if (status === 'missed') setCallError('The call was not answered.')
        else if (status === 'declined') setCallError('The call was declined.')
        cleanupMedia()
        updateCall(null)
      })
      connection.on('disconnect', () => {
        if (callRef.current?.phase === 'active') updateCall({ ...callRef.current, phase: 'reconnecting' })
      })
    }).catch((error) => {
      if (mounted) setCallError(error.message || 'Call signaling could not connect.')
    })
    return () => {
      mounted = false
      socket?.disconnect()
      socketRef.current = null
      cleanupMedia()
      callRef.current = null
    }
  }, [cleanupMedia, createPeer, enabled, endCall, handleSignal, sendSignal, updateCall])

  const startCall = useCallback(async (conversation, mediaType) => {
    if (!enabled || callRef.current) return
    setCallError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setCallError('Calling is not supported in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mediaType === 'video',
      })
      localStreamRef.current = stream
      setLocalStream(stream)
      const socket = socketRef.current
      if (!socket?.connected) throw new Error('Call signaling is connecting. Try again in a moment.')
      const startedCall = await emitAck(socket, 'call:start', { conversationId: conversation.id, mediaType })
      updateCall({
        ...startedCall,
        phase: 'outgoing',
        initiator: true,
        peerName: conversation.nickname || conversation.name,
        peerProfilePicture: conversation.profilePicture || null,
      })
    } catch (error) {
      cleanupMedia()
      setCallError(error.name === 'NotAllowedError'
        ? 'Allow microphone and camera access to place this call.'
        : error.name === 'NotFoundError'
          ? 'The requested microphone or camera was not found.'
          : error.message || 'The call could not be started.')
    }
  }, [cleanupMedia, enabled, updateCall])

  const acceptCall = useCallback(async () => {
    const activeCall = callRef.current
    if (!activeCall || activeCall.phase !== 'incoming') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: activeCall.mediaType === 'video',
      })
      localStreamRef.current = stream
      setLocalStream(stream)
      const accepted = await emitAck(socketRef.current, 'call:accept', { callId: activeCall.id })
      updateCall({ ...activeCall, phase: 'connecting', acceptedAt: accepted.acceptedAt })
      await createPeer(activeCall)
    } catch (error) {
      setCallError(error.name === 'NotAllowedError'
        ? 'Allow microphone and camera access to answer this call.'
        : error.message || 'The call could not be answered.')
      endCall('failed')
    }
  }, [createPeer, endCall, updateCall])

  const declineCall = useCallback(() => endCall('declined'), [endCall])

  const toggleMute = useCallback(() => {
    const nextMuted = !muted
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) track.enabled = !nextMuted
    setMuted(nextMuted)
  }, [muted])

  const toggleCamera = useCallback(() => {
    const nextEnabled = !cameraEnabled
    for (const track of localStreamRef.current?.getVideoTracks() ?? []) track.enabled = nextEnabled
    setCameraEnabled(nextEnabled)
  }, [cameraEnabled])

  return {
    call,
    localStream,
    remoteStream,
    muted,
    cameraEnabled,
    callError,
    clearCallError: () => setCallError(''),
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
  }
}
