import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

export default function UserAvatar({ person, className = '', alt = '' }) {
  const source = person?.profilePicture || person?.groupPicture || person?.photo || ''
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [source])

  if (source && !imageFailed) {
    return <img className={`avatar ${className}`.trim()} src={source} alt={alt} onError={() => setImageFailed(true)} />
  }

  return <span className={`avatar avatar--profile-placeholder ${className}`.trim()} aria-hidden="true"><Icon name="profile" size={19} /></span>
}
