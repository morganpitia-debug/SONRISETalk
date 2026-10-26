import { request } from './auth.js'

function requestData(path, options) {
  return request(path, options).then((response) => response.data)
}

export function searchUsers(query, { signal } = {}) {
  const params = new URLSearchParams({ q: query })
  return requestData(`/api/users/search?${params.toString()}`, { signal })
}

export function updateProfile(profile) {
  return request('/api/profiles/me', {
    method: 'PATCH',
    body: JSON.stringify({
      name: profile.name,
      username: profile.username,
      bio: profile.bio,
      profilePicture: profile.profilePicture,
    }),
  }).then(({ data }) => data.profile)
}

export function getProfile(username) {
  return requestData(`/api/profiles/${encodeURIComponent(username)}`)
}

export function getHighlightStories() {
  return requestData('/api/highlights/stories')
}

export function getHighlight(highlightId) {
  return requestData(`/api/highlights/${encodeURIComponent(highlightId)}`)
}

export function createHighlight({ title, storyIds, coverStoryId, coverMedia }) {
  return requestData('/api/highlights', {
    method: 'POST',
    body: JSON.stringify({ title, storyIds, coverStoryId, coverMedia }),
  })
}

export function updateHighlight(highlightId, { title, storyIds, coverStoryId, coverMedia }) {
  return requestData(`/api/highlights/${encodeURIComponent(highlightId)}`, {
    method: 'PUT',
    body: JSON.stringify({ title, storyIds, coverStoryId, coverMedia }),
  })
}

export function deleteHighlight(highlightId) {
  return request(`/api/highlights/${encodeURIComponent(highlightId)}`, { method: 'DELETE' })
}

export function reorderHighlights(highlightIds) {
  return requestData('/api/highlights/order', {
    method: 'PUT',
    body: JSON.stringify({ highlightIds }),
  })
}

export function reportUser(userId, { reason, details }) {
  return request(`/api/users/${encodeURIComponent(userId)}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, details }),
  })
}

export function getProfileConnections(username, type) {
  const params = new URLSearchParams({ type })
  return requestData(`/api/profiles/${encodeURIComponent(username)}/connections?${params.toString()}`)
}

export function getFeed({ cursor, limit = 20 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return requestData(`/api/posts/feed?${params.toString()}`)
}

export function getDiscoverPosts() {
  return requestData('/api/posts/discover')
}

export function createPost({ content, caption, format = 'Post', media = [] }) {
  return request('/api/posts', {
    method: 'POST',
    body: JSON.stringify({ content, caption, format, media }),
  })
}

export function deletePost(postId) {
  return request(`/api/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' })
}

export function setPostLiked(postId, liked) {
  return request(`/api/posts/${encodeURIComponent(postId)}/like`, { method: liked ? 'PUT' : 'DELETE' })
}

export function setPostSaved(postId, saved) {
  return request(`/api/posts/${encodeURIComponent(postId)}/save`, { method: saved ? 'PUT' : 'DELETE' })
}

export function getSavedPosts() {
  return requestData('/api/posts/saved')
}

export function getPostComments(postId) {
  return requestData(`/api/posts/${encodeURIComponent(postId)}/comments`)
}

export function addPostComment(postId, content) {
  return requestData(`/api/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export function getStories() {
  return requestData('/api/stories')
}

export function deleteStory(storyId) {
  return request(`/api/stories/${encodeURIComponent(storyId)}`, { method: 'DELETE' })
}

export function muteStoryAuthor(storyId) {
  return request(`/api/stories/${encodeURIComponent(storyId)}/mute`, { method: 'PUT' })
}

export function createStory({ media, caption }) {
  return request('/api/stories', {
    method: 'POST',
    body: JSON.stringify({ media, caption }),
  })
}

export function markStoryViewed(storyId) {
  return request(`/api/stories/${encodeURIComponent(storyId)}/view`, { method: 'POST' })
}

export function getStoryInsights(storyId) {
  return requestData(`/api/stories/${encodeURIComponent(storyId)}/insights`)
}

export function setStoryLiked(storyId, liked) {
  return request(`/api/stories/${encodeURIComponent(storyId)}/like`, { method: liked ? 'PUT' : 'DELETE' })
}

export function getNotes() {
  return requestData('/api/notes')
}

export function saveNote({ content, audience }) {
  return requestData('/api/notes/me', {
    method: 'PUT',
    body: JSON.stringify({ content, audience }),
  })
}

export function deleteNote() {
  return request('/api/notes/me', { method: 'DELETE' })
}

export function setFollowed(userId, following) {
  return requestData(`/api/follows/${encodeURIComponent(userId)}`, { method: following ? 'POST' : 'DELETE' })
}

export function getMyFollows() {
  return requestData('/api/follows/me')
}

export function getFollowRequests() {
  return requestData('/api/follows/requests')
}

export function resolveFollowRequest(followerId, status) {
  return request(`/api/follows/requests/${encodeURIComponent(followerId)}`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })
}

export function getNotifications() {
  return requestData('/api/notifications')
}

export function markNotificationRead(notificationId) {
  return request(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' })
}

export function markAllNotificationsRead() {
  return request('/api/notifications/read-all', { method: 'PATCH' })
}

export function getPrivacySettings() {
  return requestData('/api/settings/privacy')
}

export function updatePrivacySettings(privacy) {
  return requestData('/api/settings/privacy', {
    method: 'PUT',
    body: JSON.stringify({ privacy }),
  })
}

export function uploadMedia(file) {
  const data = new FormData()
  const mimeType = file.type.split(';', 1)[0].trim().toLowerCase()
  const uploadFile = mimeType && mimeType !== file.type
    ? new File([file], file.name, { type: mimeType, lastModified: file.lastModified })
    : file
  data.append('file', uploadFile)
  return request('/api/media/upload', { method: 'POST', body: data }).then(({ data: media }) => media)
}
