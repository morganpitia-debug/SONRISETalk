export function isAllowedOrigin(request, allowedOrigins) {
  const origin = request.headers.origin
  if (!origin || allowedOrigins.includes(origin)) return true

  const forwardedHost = request.headers['x-forwarded-host']?.split(',')[0].trim()
  const forwardedProtocol = request.headers['x-forwarded-proto']?.split(',')[0].trim()
  const host = forwardedHost || request.headers.host
  const protocol = forwardedProtocol || (request.socket?.encrypted ? 'https' : 'http')
  if (!host) return false

  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }
}
