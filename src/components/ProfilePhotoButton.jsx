export default function ProfilePhotoButton({ person, onViewProfile, className = '', children }) {
  const name = person.name || person.author || 'this person'
  return (
    <button
      className={`profile-photo-button ${className}`.trim()}
      type="button"
      aria-label={`View ${name}'s profile`}
      title={`View ${name}'s profile`}
      onClick={() => onViewProfile?.(person.own ? null : person.username || person.handle || person.profileId || person.id || person)}
    >
      {children}
    </button>
  )
}
