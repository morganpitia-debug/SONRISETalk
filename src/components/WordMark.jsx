import BrandMark from './BrandMark.jsx'

export default function WordMark() {
  return (
    <a className="wordmark" href="#home" aria-label="Trex home">
      <BrandMark size={35} className="wordmark__symbol" />
      <span>Trex</span>
    </a>
  )
}