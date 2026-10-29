import BrandMark from './BrandMark.jsx'
import NavigationItem from './NavigationItem.jsx'

const destinations = [
  { label: 'Home', icon: 'home' },
  { label: 'Discover', icon: 'discover' },
  { label: 'Messages', icon: 'messages' },
  { label: 'Create', icon: 'pen' },
  { label: 'Profile', icon: 'profile' },
  { label: 'More', icon: 'more' },
]

export default function FloatingNavigation({ activePage, onNavigate, expanded, onHoverChange, onMoreToggle, moreOpen, isAdmin = false, unreadMessageCount = 0 }) {
  return (
    <div className="navigation-dock">
      <nav
        className={`floating-navigation glass-surface${expanded ? ' is-expanded' : ''}${isAdmin ? ' has-admin' : ''}`}
        aria-label="Main navigation"
        aria-expanded={expanded}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse' && window.matchMedia('(min-width: 761px)').matches) onHoverChange(true)
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse' && window.matchMedia('(min-width: 761px)').matches) onHoverChange(false)
        }}
      >
        <span className="navigation-caption">YOUR SPACE</span>
        {destinations.map(({ label, icon }) => (
          <NavigationItem
            key={label}
            label={label}
            icon={icon}
            active={label === 'More' ? moreOpen : activePage === label}
            badgeCount={label === 'Messages' ? unreadMessageCount : 0}
            onClick={() => label === 'More' ? onMoreToggle() : onNavigate(label)}
          />
        ))}
        {isAdmin && <NavigationItem label="Admin" icon="admin" active={activePage === 'Admin'} onClick={() => onNavigate('Admin')} />}
        <span className="navigation-index" aria-hidden="true">ST / 01</span>
      </nav>
      <button
        className={`navigation-ai-button glass-surface${activePage === 'Trex AI' ? ' is-active' : ''}`}
        type="button"
        aria-label="Open Trex AI"
        aria-current={activePage === 'Trex AI' ? 'page' : undefined}
        onClick={() => onNavigate('Trex AI')}
      >
        <BrandMark size={25} />
      </button>
    </div>
  )
}