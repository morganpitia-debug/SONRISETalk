export function getPushConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim()
  let validSubject = subject?.startsWith('mailto:')
  if (subject?.startsWith('https://')) {
    try {
      validSubject = Boolean(new URL(subject).hostname)
    } catch {
      validSubject = false
    }
  }
  const configured = Boolean(
    publicKey && /^[A-Za-z0-9_-]{80,100}$/.test(publicKey)
    && privateKey && /^[A-Za-z0-9_-]{40,50}$/.test(privateKey)
    && validSubject,
  )
  return {
    configured,
    publicKey: configured ? publicKey : null,
  }
}
