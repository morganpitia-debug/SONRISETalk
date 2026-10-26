export default function BrandMark({ size = 34, className = '' }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
    >
      <path d="M8 27.5 18.6 17l6.2 6.2L33 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25.5 15H33v7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="27.5" r="3" fill="currentColor" />
      <circle cx="18.6" cy="17" r="2.4" fill="currentColor" />
      <circle cx="24.8" cy="23.2" r="2.4" fill="currentColor" />
      <circle cx="33" cy="15" r="3" fill="currentColor" />
    </svg>
  )
}