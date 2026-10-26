import { request } from './auth.js'

function requestData(path, options) {
  return request(path, options).then((response) => response.data)
}

export function getAdminStatus() {
  return requestData('/api/admin/status')
}

export function promoteToAdmin(password) {
  return requestData('/api/admin/promote', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export function getAdminUsers({ query = '', cursor, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (query) params.set('q', query)
  if (cursor) params.set('cursor', cursor)
  return requestData(`/api/admin/users?${params.toString()}`)
}

export function getAdminReports() {
  return requestData('/api/admin/reports')
}

export function getAdminAccount(userId) {
  return requestData(`/api/admin/users/${encodeURIComponent(userId)}`)
}

export function updateAdminReport(reportId, status) {
  return request(`/api/admin/reports/${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function deleteAdminAccount(userId) {
  return request(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}
