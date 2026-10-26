import BrandMark from './BrandMark.jsx'

export default function WordMark() {
  return (
    <a className="wordmark" href="#home" aria-label="SONRISETALK home">
      <BrandMark size={35} className="wordmark__symbol" />
      <span>SONRISE<span className="wordmark__light">TALK</span></span>
    </a>
  )
}