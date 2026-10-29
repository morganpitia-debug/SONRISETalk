import { useEffect } from 'react'
import Icon from './Icon.jsx'

const menuGroups = [
  [{ id: 'Settings', icon: 'settings', label: 'Settings', detail: 'Manage your experience' }],
  [
    { id: 'Switch account', icon: 'account', label: 'Switch account', detail: 'Choose another profile' },
    { id: 'Saved', icon: 'saved', label: 'Saved', detail: 'Find posts you bookmarked' },
    { id: 'History', icon: 'history', label: 'Activity / History', detail: 'Activity history is not available yet' },
  ],
  [
    { id: 'Help & support', icon: 'help', label: 'Help & support', detail: 'Find a little guidance' },
    { id: 'About Trex', icon: 'sparkle', label: 'About Trex', detail: 'A quieter kind of together' },
  ],
]

export default function MoreMenu({ onClose, onSelect, onLogout }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="more-menu-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="more-menu-panel" role="dialog" aria-modal="true" aria-labelledby="more-menu-title">
        <div className="more-menu__heading"><div><span className="more-menu__eyebrow">Trex</span><h2 id="more-menu-title">More</h2></div><button type="button" aria-label="Close More menu" onClick={onClose}><Icon name="close" size={18} /></button></div>
        {menuGroups.map((group, index) => <div className="more-menu__group" key={index}>{group.map((item) => <button className="more-menu__item" type="button" key={item.id} onClick={() => onSelect(item.id)}><span><Icon name={item.icon} size={17} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><Icon name="chevron" size={15} /></button>)}</div>)}
        <button className="more-menu__logout" type="button" onClick={onLogout}><Icon name="logout" size={16} /> Log out</button>
      </section>
    </div>
  )
}
