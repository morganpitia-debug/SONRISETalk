import BrandMark from './BrandMark.jsx'
import GlassSurface from './GlassSurface.jsx'
import Icon from './Icon.jsx'

export default function SonriseAIEntry({ active, onClick }) {
  return (
    <GlassSurface as="button" className={`ai-entry${active ? ' is-active' : ''}`} type="button" onClick={onClick} aria-label="Open Sonrise AI">
      <span className="ai-entry__mark"><BrandMark size={24} /></span>
      <span className="ai-entry__copy"><span className="ai-entry__eyebrow">A LITTLE LIGHT</span><strong>Sonrise AI</strong></span>
      <Icon className="ai-entry__arrow" name="arrow" size={16} strokeWidth={1.7} />
    </GlassSurface>
  )
}