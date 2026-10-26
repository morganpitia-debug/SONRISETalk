export function getAvatarInitial(person = {}) {
  const username = person.username || person.handle || person.name || ''
  const firstCharacter = username.replace(/^@/, '').trim().charAt(0)
  return firstCharacter.toLocaleUpperCase() || '?'
}
