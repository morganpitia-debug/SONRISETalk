export function isApiEnabled() {
  return import.meta.env.PROD || Boolean(import.meta.env.VITE_API_URL)
}

export function getAuthToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem('sonrisetalk-auth-token')
    || window.sessionStorage.getItem('sonrisetalk-auth-token')
}

export function loginAccount({ identifier, password }) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  })
}

export function registerAccount(account) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(account),
  })
}

export function logoutAccount() {
  return request('/api/auth/logout', { method: 'POST' })
}

export async function request(path, { method = 'GET', body, headers = {}, signal, responseType } = {}) {
  const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`

  const authToken = getAuthToken()
  const response = await fetch(url, {
    method,
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    signal,
  })

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const payload = await response.json()
      throw new Error(payload.error?.message || `Request failed: ${response.status}`)
    }
    const text = await response.text()
    throw new Error(text || `Request failed: ${response.status}`)
  }

  if (response.status === 204) return null
  if (responseType === 'blob') return response.blob()

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  return response.text()
}
