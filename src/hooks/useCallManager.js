import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { createRealtimeSocket, getIceServers } from '../api/messaging.js'

export const CallManagerContext = createContext(null)

const CALL_AUDIO_CONSTRAINTS = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  channelCount: { ideal: 1 },
}

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

function scheduleCallTone(audioContext, frequencies, startAt, duration) {
  for (const frequency of frequencies) {
    const oscillator = audioContext.createOscillator()
    const envelope = audioContext.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, startAt)
    envelope.gain.setValueAtTime(0, startAt)
    envelope.gain.linearRampToValueAtTime(0.12, startAt + 0.035)
    envelope.gain.setValueAtTime(0.12, startAt + duration - 0.04)
    envelope.gain.linearRampToValueAtTime(0, startAt + duration)
    oscillator.connect(envelope)
    envelope.connect(audioContext.destination)
    oscillator.start(startAt)
    oscillator.stop(startAt + duration + 0.02)
  }
}

export default function useCallManager(enabled, currentUserId) {
  const [call, setCall] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [muted, setMuted] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [screenStream, setScreenStream] = useState(null)
  const [groupParticipants, setGroupParticipants] = useState([])
  const [callError, setCallError] = useState('')
  const [callActivities, setCallActivities] = useState([])
  const socketRef = useRef(null)
  const callRef = useRef(null)
  const peerRef = useRef(null)
  const groupRoomRef = useRef(null)
  const videoSenderRef = useRef(null)
  const screenStreamRef = useRef(null)
  const cameraTrackRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteStreamRef = useRef(null)
  const candidateQueueRef = useRef([])
  const recoveryTimerRef = useRef(null)
  const recoveryAttemptsRef = useRef(0)
  const callAudioContextRef = useRef(null)

  const getCallAudioContext = useCallback(() => {
    if (typeof window === 'undefined') return null
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextConstructor) return null
    if (!callAudioContextRef.current || callAudioContextRef.current.state === 'closed') {
      callAudioContextRef.current = new AudioContextConstructor()
    }
    if (callAudioContextRef.current.state === 'suspended') {
      callAudioContextRef.current.resume().catch((error) => {
        console.warn('Call audio could not be enabled by the browser.', error)
      })
    }
    return callAudioContextRef.current
  }, [])

  const updateCall = useCallback((next) => {
    const value = typeof next === 'function' ? next(callRef.current) : next
    if (callRef.current?.id !== value?.id) setCallActivities([])
    callRef.current = value
    setCall(value)
  }, [])

  const cleanupMedia = useCallback(() => {
    const groupRoom = groupRoomRef.current
    groupRoomRef.current = null
    if (groupRoom) {
      groupRoom.removeAllListeners()
      groupRoom.disconnect().catch((error) => console.warn('LiveKit call disconnected with an error.', error))
    }
    setGroupParticipants([])
    if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current)
    recoveryTimerRef.current = null
    recoveryAttemptsRef.current = 0
    peerRef.current?.close()
    peerRef.current = null
    videoSenderRef.current = null
    const activeScreenStream = screenStreamRef.current
    screenStreamRef.current = null
    activeScreenStream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    cameraTrackRef.current = null
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop())
    remoteStreamRef.current = null
    candidateQueueRef.current = []
    setLocalStream(null)
    setRemoteStream(null)
    setScreenStream(null)
    setMuted(false)
    setCameraEnabled(true)
  }, [])

  useEffect(() => {
    const phase = call?.phase
    if (phase !== 'incoming' && phase !== 'outgoing') return undefined
    const audioContext = getCallAudioContext()
    if (!audioContext) return undefined

    const ring = () => {
      const startAt = audioContext.currentTime + 0.04
      if (phase === 'outgoing') {
        scheduleCallTone(audioContext, [440, 480], startAt, 1.7)
      } else {
        scheduleCallTone(audioContext, [659, 880], startAt, 0.22)
        scheduleCallTone(audioContext, [659, 880], startAt + 0.34, 0.22)
      }
    }
    ring()
    const interval = window.setInterval(ring, phase === 'incoming' ? 3200 : 4000)
    return () => {
      window.clearInterval(interval)
      if (callAudioContextRef.current === audioContext) callAudioContextRef.current = null
      audioContext.close().catch((error) => {
        console.warn('Call audio could not be stopped cleanly.', error)
      })
    }
  }, [call?.id, call?.phase, getCallAudioContext])

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
      if (socket?.connected) {
        if (activeCall.callMode === 'group') {
          await emitAck(socket, activeCall.initiator ? 'call:group-end' : 'call:group-leave', { callId: activeCall.id })
        } else {
          await emitAck(socket, 'call:end', { callId: activeCall.id, status })
        }
      }
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
    videoSenderRef.current = peer.getSenders().find((sender) => sender.track?.kind === 'video')
      ?? peer.addTransceiver('video', { direction: 'sendrecv' }).sender
    cameraTrackRef.current = localStreamRef.current?.getVideoTracks()[0] ?? null
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

  const connectGroupCall = useCallback(async (activeCall) => {
    const socket = socketRef.current
    if (!socket?.connected) throw new Error('Call signaling is connecting. Try again in a moment.')
    const credentials = await emitAck(socket, 'call:group-join', { callId: activeCall.id })
    const { Room, RoomEvent, Track } = await import('livekit-client')
    const room = new Room({ adaptiveStream: true, dynacast: true })
    groupRoomRef.current = room
    const readParticipants = () => {
      if (groupRoomRef.current !== room) return
      const readMediaTrack = (participant, source) => participant.getTrackPublication(source)?.track?.mediaStreamTrack ?? null
      const localParticipant = room.localParticipant
      setGroupParticipants([
        {
          userId: localParticipant.identity,
          name: localParticipant.name || 'You',
          isLocal: true,
          audioTrack: readMediaTrack(localParticipant, Track.Source.Microphone),
          videoTrack: readMediaTrack(localParticipant, Track.Source.ScreenShare) || readMediaTrack(localParticipant, Track.Source.Camera),
        },
        ...[...room.remoteParticipants.values()].map((participant) => ({
          userId: participant.identity,
          name: participant.name || 'Participant',
          isLocal: false,
          audioTrack: readMediaTrack(participant, Track.Source.Microphone),
          videoTrack: readMediaTrack(participant, Track.Source.ScreenShare) || readMediaTrack(participant, Track.Source.Camera),
        })),
      ])
    }
    room.on(RoomEvent.ParticipantConnected, readParticipants)
    room.on(RoomEvent.ParticipantDisconnected, readParticipants)
    room.on(RoomEvent.TrackSubscribed, readParticipants)
    room.on(RoomEvent.TrackUnsubscribed, readParticipants)
    room.on(RoomEvent.TrackMuted, readParticipants)
    room.on(RoomEvent.TrackUnmuted, readParticipants)
    room.on(RoomEvent.LocalTrackPublished, readParticipants)
    room.on(RoomEvent.LocalTrackUnpublished, readParticipants)
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (callRef.current?.id !== activeCall.id) return
      updateCall({ ...callRef.current, phase: state === 'connected' ? 'active' : state === 'reconnecting' ? 'reconnecting' : 'connecting' })
    })
    room.on(RoomEvent.Disconnected, () => {
      if (groupRoomRef.current !== room || callRef.current?.id !== activeCall.id) return
      groupRoomRef.current = null
      setCallError('The group call connection ended.')
      cleanupMedia()
      if (socketRef.current?.connected) {
        emitAck(socketRef.current, 'call:group-leave', { callId: activeCall.id }).catch((error) => {
          console.warn('Could not update group call membership after disconnect.', error)
        })
      }
      updateCall(null)
    })
    try {
      await room.connect(credentials.url, credentials.token)
      await room.localParticipant.setMicrophoneEnabled(true, CALL_AUDIO_CONSTRAINTS)
      await room.localParticipant.setCameraEnabled(activeCall.mediaType === 'video')
      setMuted(false)
      setCameraEnabled(activeCall.mediaType === 'video')
      readParticipants()
      updateCall({
        ...activeCall,
        phase: 'active',
        acceptedAt: activeCall.acceptedAt || new Date().toISOString(),
        currentUserId,
        invitedPeople: credentials.invitations ?? activeCall.invitedPeople ?? [],
      })
    } catch (error) {
      if (groupRoomRef.current === room) groupRoomRef.current = null
      room.removeAllListeners()
      await room.disconnect()
      await emitAck(socket, 'call:group-leave', { callId: activeCall.id }).catch((leaveError) => {
        console.error('Could not remove the failed group-call participant.', leaveError)
      })
      throw error
    }
  }, [cleanupMedia, currentUserId, updateCall])

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
          currentUserId,
        })
      })
      connection.on('call:group-incoming', (incomingCall) => {
        if (callRef.current?.id === incomingCall.id && callRef.current.callMode === 'group') {
          emitAck(connection, 'call:group-join', { callId: incomingCall.id }).catch((error) => {
            setCallError(error.message || 'The group call could not reconnect to signaling.')
          })
          return
        }
        if (callRef.current) {
          emitAck(connection, 'call:group-decline', { callId: incomingCall.id }).catch((error) => setCallError(error.message))
          return
        }
        updateCall({
          ...incomingCall,
          callMode: 'group',
          phase: 'incoming',
          initiator: Boolean(incomingCall.isHost),
          peerName: incomingCall.groupName,
          peerProfilePicture: null,
          currentUserId,
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
      connection.on('call:activity', (event) => {
        if (callRef.current?.id !== event?.callId || !event.activity) return
        setCallActivities((current) => [...current.slice(-99), event])
      })
      connection.on('call:participant-joined', ({ callId, participant }) => {
        const activeCall = callRef.current
        if (activeCall?.id !== callId || !participant?.userId) return
        updateCall({
          ...activeCall,
          invitedPeople: (activeCall.invitedPeople ?? []).filter((person) => person.userId !== participant.userId),
        })
      })
      connection.on('call:group-declined', ({ callId, userId: declinedUserId }) => {
        const activeCall = callRef.current
        if (activeCall?.id !== callId || !declinedUserId) return
        updateCall({
          ...activeCall,
          invitedPeople: (activeCall.invitedPeople ?? []).filter((person) => person.userId !== declinedUserId),
        })
      })
      connection.on('call:ended', ({ callId, status }) => {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.controller?.postMessage({ type: 'CALL_ENDED', callId })
        }
        if (callRef.current?.id !== callId) return
        if (status === 'missed') setCallError('The call was not answered.')
        else if (status === 'declined') setCallError('The call was declined.')
        cleanupMedia()
        updateCall(null)
      })
      connection.on('disconnect', () => {
        if (callRef.current?.phase === 'active') updateCall({ ...callRef.current, phase: 'reconnecting' })
      })
      connection.on('connect', () => {
        if (callRef.current?.callMode === 'group' && groupRoomRef.current?.state === 'connected') {
          updateCall({ ...callRef.current, phase: 'active' })
        }
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
  }, [cleanupMedia, createPeer, currentUserId, enabled, endCall, handleSignal, sendSignal, updateCall])

  const startCall = useCallback(async (conversation, mediaType) => {
    if (!enabled || callRef.current) return
    getCallAudioContext()
    setCallError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setCallError('Calling is not supported in this browser.')
      return
    }
    if (conversation.groupName && conversation.members?.length > 2) {
      try {
        const socket = socketRef.current
        if (!socket?.connected) throw new Error('Call signaling is connecting. Try again in a moment.')
        const startedCall = await emitAck(socket, 'call:start', { conversationId: conversation.id, mediaType })
        const groupCall = {
          ...startedCall,
          callMode: 'group',
          phase: 'connecting',
          initiator: true,
          peerName: conversation.groupName,
          currentUserId,
        }
        updateCall(groupCall)
        await connectGroupCall(groupCall)
      } catch (error) {
        if (callRef.current?.callMode === 'group') await endCall('failed')
        else cleanupMedia()
        setCallError(error.message || 'The group call could not be started.')
      }
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: CALL_AUDIO_CONSTRAINTS,
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
        currentUserId,
      })
    } catch (error) {
      cleanupMedia()
      setCallError(error.name === 'NotAllowedError'
        ? 'Allow microphone and camera access to place this call.'
        : error.name === 'NotFoundError'
          ? 'The requested microphone or camera was not found.'
          : error.message || 'The call could not be started.')
    }
  }, [cleanupMedia, connectGroupCall, currentUserId, enabled, endCall, getCallAudioContext, updateCall])

  const acceptCall = useCallback(async () => {
    const activeCall = callRef.current
    if (!activeCall || activeCall.phase !== 'incoming') return
    getCallAudioContext()
    if (activeCall.callMode === 'group') {
      updateCall({ ...activeCall, phase: 'connecting' })
      try {
        await connectGroupCall({ ...activeCall, phase: 'connecting' })
      } catch (error) {
        cleanupMedia()
        updateCall(null)
        setCallError(error.message || 'The group call could not be joined.')
      }
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: CALL_AUDIO_CONSTRAINTS,
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
  }, [cleanupMedia, connectGroupCall, createPeer, endCall, getCallAudioContext, updateCall])

  const declineCall = useCallback(() => {
    const activeCall = callRef.current
    if (activeCall?.callMode === 'group' && activeCall.phase === 'incoming') {
      emitAck(socketRef.current, 'call:group-decline', { callId: activeCall.id })
        .catch((error) => setCallError(error.message))
        .finally(() => updateCall(null))
      return
    }
    endCall('declined')
  }, [endCall, updateCall])

  const toggleMute = useCallback(async () => {
    const nextMuted = !muted
    if (groupRoomRef.current) {
      try {
        await groupRoomRef.current.localParticipant.setMicrophoneEnabled(!nextMuted, CALL_AUDIO_CONSTRAINTS)
      } catch (error) {
        setCallError(error.message || 'The microphone could not be updated.')
        return
      }
    }
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) track.enabled = !nextMuted
    setMuted(nextMuted)
  }, [muted])

  const toggleCamera = useCallback(async () => {
    const nextEnabled = !cameraEnabled
    if (groupRoomRef.current) {
      try {
        await groupRoomRef.current.localParticipant.setCameraEnabled(nextEnabled)
      } catch (error) {
        setCallError(error.message || 'The camera could not be updated.')
        return
      }
    }
    for (const track of localStreamRef.current?.getVideoTracks() ?? []) track.enabled = nextEnabled
    setCameraEnabled(nextEnabled)
  }, [cameraEnabled])

  const sendCallActivity = useCallback(async (activity) => {
    const activeCall = callRef.current
    const socket = socketRef.current
    if (!activeCall || activeCall.phase !== 'active' || !socket?.connected) {
      throw new Error('Call updates are available after the connection is active.')
    }
    const result = await emitAck(socket, 'call:activity', { callId: activeCall.id, activity })
    if (!result?.activity) throw new Error('The call update was not delivered.')
    setCallActivities((current) => [...current.slice(-99), result.activity])
  }, [])

  const invitePeople = useCallback(async (userIds) => {
    const activeCall = callRef.current
    const socket = socketRef.current
    if (!activeCall || activeCall.callMode !== 'group' || activeCall.phase !== 'active' || !socket?.connected) {
      throw new Error('You can invite people after joining an active group call.')
    }
    const result = await emitAck(socket, 'call:group-invite', { callId: activeCall.id, userIds })
    updateCall({
      ...callRef.current,
      invitedPeople: [
        ...(callRef.current?.invitedPeople ?? []).filter((person) => !result.invited.some((invite) => invite.userId === person.userId)),
        ...result.invited,
      ],
    })
    return result.invited
  }, [updateCall])

  const stopScreenShare = useCallback(async () => {
    if (groupRoomRef.current) {
      await groupRoomRef.current.localParticipant.setScreenShareEnabled(false)
      setScreenStream(null)
      screenStreamRef.current = null
      await sendCallActivity({ type: 'share', sharing: false })
      return
    }
    const stream = screenStreamRef.current
    if (!stream) return
    const sender = videoSenderRef.current
    if (sender) await sender.replaceTrack(cameraTrackRef.current)
    screenStreamRef.current = null
    setScreenStream(null)
    stream.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    const activeCall = callRef.current
    if (activeCall?.phase === 'active') await sendCallActivity({ type: 'share', sharing: false })
  }, [sendCallActivity])

  const startScreenShare = useCallback(async () => {
    if (groupRoomRef.current) {
      const { Track } = await import('livekit-client')
      await groupRoomRef.current.localParticipant.setScreenShareEnabled(true, { audio: false })
      const screenTrack = groupRoomRef.current.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack
      if (!screenTrack) {
        await groupRoomRef.current.localParticipant.setScreenShareEnabled(false)
        throw new Error('The screen capture track could not be published.')
      }
      setScreenStream(new MediaStream([screenTrack]))
      await sendCallActivity({ type: 'share', sharing: true })
      return
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen sharing is not supported in this browser.')
    }
    const activeCall = callRef.current
    const sender = videoSenderRef.current
    if (!activeCall || activeCall.phase !== 'active' || !sender) {
      throw new Error('Screen sharing is available after the call connects.')
    }
    if (screenStreamRef.current) return
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    const track = stream.getVideoTracks()[0]
    if (!track) {
      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop())
      throw new Error('No screen or window was selected for sharing.')
    }
    try {
      await sender.replaceTrack(track)
      screenStreamRef.current = stream
      setScreenStream(stream)
      track.onended = () => {
        stopScreenShare().catch((error) => setCallError(error.message))
      }
      await sendCallActivity({ type: 'share', sharing: true })
    } catch (error) {
      await sender.replaceTrack(cameraTrackRef.current).catch(() => {})
      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop())
      screenStreamRef.current = null
      setScreenStream(null)
      throw error
    }
  }, [sendCallActivity, stopScreenShare])

  const toggleScreenShare = useCallback(() => (
    screenStreamRef.current ? stopScreenShare() : startScreenShare()
  ), [startScreenShare, stopScreenShare])

  return {
    call,
    localStream,
    remoteStream,
    muted,
    cameraEnabled,
    screenStream,
    groupParticipants,
    callActivities,
    callError,
    clearCallError: () => setCallError(''),
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    sendCallActivity,
    invitePeople,
  }
}
