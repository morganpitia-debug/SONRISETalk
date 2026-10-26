import Icon from './Icon.jsx'

export default function NavigationItem({ icon, label, active, onClick, badgeCount = 0 }) {
  return (
    <button
      className={`navigation-item${active ? ' is-active' : ''}`}
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <span className="navigation-item__icon"><Icon name={icon} size={19} strokeWidth={1.7} /></span>
      <span className="navigation-item__label">{label}</span>
      {badgeCount > 0 && <span className="navigation-item__badge" aria-label={`${badgeCount} unread messages`}>{badgeCount > 99 ? '99+' : badgeCount}</span>}
      <span className="navigation-item__signal" />
    </button>
  )
}