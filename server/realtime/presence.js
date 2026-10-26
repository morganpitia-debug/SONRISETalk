const userSockets = new Map()

export function addOnlineSocket(userId, socketId) {
  const sockets = userSockets.get(userId) ?? new Set()
  const becameOnline = sockets.size === 0
  sockets.add(socketId)
  userSockets.set(userId, sockets)
  return becameOnline
}

export function removeOnlineSocket(userId, socketId) {
  const sockets = userSockets.get(userId)
  if (!sockets) return false
  sockets.delete(socketId)
  if (sockets.size) return false
  userSockets.delete(userId)
  return true
}

export function isUserOnline(userId) {
  return (userSockets.get(userId)?.size ?? 0) > 0
}

export function getOnlineUserIds() {
  return [...userSockets.keys()]
}
