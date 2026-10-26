const fish = [
  { id: 'one', top: '28%', left: '7%', size: 132, duration: 42, delay: -31, direction: 'east', depth: 'far' },
  { id: 'two', top: '36%', left: '70%', size: 156, duration: 52, delay: -17, direction: 'west', depth: 'near' },
  { id: 'three', top: '48%', left: '18%', size: 112, duration: 37, delay: -21, direction: 'east', depth: 'near' },
  { id: 'four', top: '58%', left: '77%', size: 126, duration: 46, delay: -39, direction: 'west', depth: 'far' },
  { id: 'five', top: '69%', left: '36%', size: 174, duration: 55, delay: -12, direction: 'east', depth: 'far' },
  { id: 'six', top: '81%', left: '84%', size: 104, duration: 34, delay: -26, direction: 'west', depth: 'near' },
  { id: 'seven', top: '91%', left: '4%', size: 140, duration: 49, delay: -8, direction: 'east', depth: 'far' },
]

function FishIllustration() {
  return (
    <svg viewBox="0 0 180 100" aria-hidden="true">
      <path d="M47 50 10 21l8 29-8 29 37-29Z" fill="#bd5528" />
      <path d="M44 49 19 29l6 21-6 21 25-20Z" fill="#ee8b43" />
      <path d="M43 43c14-18 33-25 57-22 24 3 38 14 51 29-13 17-29 28-54 30-24 2-42-5-55-24l-13-4Z" fill="#e87a35" />
      <path d="M67 31c17-11 43-14 62-5-15 0-24 5-33 14-11 10-22 13-37 13 8-7 11-13 8-22Z" fill="#f39b50" />
      <path d="M73 61c16 4 27 13 33 25-16-4-27-10-37-23Z" fill="#ca5c2d" />
      <path d="M88 49c10-8 22-10 33-7-7 6-13 14-16 24-9-2-14-8-17-17Z" fill="#f49a4b" opacity=".9" />
      <path d="M129 38c9 4 16 10 22 15-7 7-14 12-23 16 5-10 5-21 1-31Z" fill="#d76a31" />
      <path d="M58 41c14-10 29-14 43-14" fill="none" stroke="#ffb66c" strokeLinecap="round" strokeWidth="3" opacity=".6" />
      <path d="M51 53c10 7 18 10 27 11" fill="none" stroke="#b94f28" strokeLinecap="round" strokeWidth="2" opacity=".45" />
      <circle cx="137" cy="45" r="4.5" fill="#f7d79b" />
      <circle cx="138" cy="45" r="2.4" fill="#171817" />
      <circle cx="139" cy="44" r=".8" fill="#fff" />
    </svg>
  )
}

export default function UnderwaterFishLayer() {
  return (
    <div className="underwater-fish-layer" aria-hidden="true">
      {fish.map((item) => (
        <span
          key={item.id}
          className={`underwater-fish underwater-fish--${item.direction} underwater-fish--${item.depth} underwater-fish--pearl`}
          style={{
            '--fish-top': item.top,
            '--fish-left': item.left,
            '--fish-size': `${item.size}px`,
            '--swim-duration': `${item.duration}s`,
            '--swim-delay': `${item.delay}s`,
          }}
        >
          <span className="underwater-fish__art"><FishIllustration /></span>
        </span>
      ))}
    </div>
  )
}
