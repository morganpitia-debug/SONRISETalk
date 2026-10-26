import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'

const categories = [
  { group: 'ACCOUNT', items: [{ id: 'privacy', title: 'Privacy', description: 'Control who can see your profile and content.', icon: 'privacy' }, { id: 'account', title: 'Account', description: 'Your name, username and account type.', icon: 'account' }] },
  { group: 'APPEARANCE', items: [{ id: 'theme', title: 'Appearance', description: 'Choose how SONRISETALK looks.', icon: 'sun' }] },
  { group: 'AI & PERSONALIZATION', items: [{ id: 'ai', title: 'SONRISE AI', description: 'Manage what SONRISE AI can access.', icon: 'sparkle' }] },
  { group: 'ACTIVITY', items: [{ id: 'history', title: 'History', description: 'Activity history is not connected yet.', icon: 'history' }, { id: 'activity', title: 'Activity controls', description: 'Activity history is not connected yet.', icon: 'settings' }] },
  { group: 'SECURITY', items: [{ id: 'security', title: 'Security', description: 'Review account safety options.', icon: 'shield' }] },
  { group: 'GENERAL', items: [{ id: 'notifications', title: 'Notifications', description: 'Choose which activity you hear about.', icon: 'notifications' }, { id: 'language', title: 'Language', description: 'Choose your preferred language.', icon: 'language' }] },
]

const settingsCopy = {
  privacy: ['Privacy', 'Choose what you share and who can interact with you.'],
  account: ['Account', 'Manage your profile details and account type.'],
  theme: ['Appearance', 'Make SONRISETALK feel like yours.'],
  ai: ['SONRISE AI', 'Choose what SONRISE AI can access when helping you.'],
  history: ['History', 'Activity history is not connected yet.'],
  activity: ['Activity controls', 'Activity history is not connected yet.'],
  security: ['Security', 'A few helpful account safety options.'],
  notifications: ['Notifications', 'Choose the updates you would like to see.'],
  language: ['Language', 'Choose the language used in SONRISETALK.'],
}

function SettingRow({ title, description, icon, onClick }) {
  return (
    <button className="settings-category" type="button" onClick={onClick}>
      <span className="settings-category__icon"><Icon name={icon} size={18} /></span>
      <span className="settings-category__copy"><strong>{title}</strong><small>{description}</small></span>
      <Icon name="chevron" size={17} />
    </button>
  )
}

function Toggle({ checked, onChange, label }) {
  return <button className={`settings-toggle${checked ? ' is-on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>
}

function OptionRow({ title, description, value, onChange, options = ['Everyone', 'People you follow', 'No one'] }) {
  return (
    <div className="settings-option-row">
      <span><strong>{title}</strong><small>{description}</small></span>
      <select aria-label={title} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select>
    </div>
  )
}

function SwitchRow({ title, description, checked, onChange }) {
  return <div className="settings-option-row"><span><strong>{title}</strong><small>{description}</small></span><Toggle checked={checked} onChange={onChange} label={title} /></div>
}

function SectionCard({ children, title }) {
  return <section className="settings-section-card"><h2>{title}</h2>{children}</section>
}

function HistoryPanel({ history, onClear }) {
  return (
    <>
      <SectionCard title="Your history">
        {history.length ? history.map((group) => (
          <div className="settings-history-group" key={group.group}>
            <h3>{group.group}</h3>
            {group.events.map((event) => <div className="settings-history-item" key={event}><span className="settings-history-item__dot" /><span>{event}</span></div>)}
          </div>
        )        ) : <p className="settings-empty-history">Activity history is not connected yet.</p>}
      </SectionCard>
      {history.length > 0 && <button className="settings-danger-button" type="button" onClick={onClear}>Clear history</button>}
    </>
  )
}

function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="settings-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="settings-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-confirm-title">
        <h2 id="settings-confirm-title">{title}</h2><p>{description}</p>
        <div><button type="button" className="settings-secondary-button" onClick={onCancel}>Cancel</button><button type="button" className="settings-danger-button" onClick={onConfirm}>{confirmLabel}</button></div>
      </section>
    </div>
  )
}

export default function SettingsPage({ profile, theme, onThemeChange, sceneTheme = 'default', onSceneThemeChange, onOpenProfile, isPrivateAccount, onPrivateAccountChange, initialSection = null, onInitialSectionOpened, aiPermissions, onAIPermissionsChange, isAdmin = false, onAdminPromote }) {
  const [section, setSection] = useState(initialSection)
  const [privacy, setPrivacy] = useState({ profile: 'Everyone', content: 'Everyone', mentions: 'People you follow', interactions: 'People you follow' })
  const [notifications, setNotifications] = useState({ push: true, likes: true, comments: true, messages: true, mentions: true })
  const [historyControls, setHistoryControls] = useState({ reels: true, searches: true, profileVisits: true })
  const [securityToggles, setSecurityToggles] = useState({ twoFactor: false })
  const [language, setLanguage] = useState('English')
  const [history, setHistory] = useState([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [notice, setNotice] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminPasswordOpen, setAdminPasswordOpen] = useState(false)
  const [adminPasswordVisible, setAdminPasswordVisible] = useState(false)
  const [adminPromotionError, setAdminPromotionError] = useState('')
  const [adminPromoting, setAdminPromoting] = useState(false)

  useEffect(() => {
    if (initialSection) onInitialSectionOpened?.()
  }, [initialSection, onInitialSectionOpened])

  function toggleObject(setter, key, value) {
    setter((current) => ({ ...current, [key]: value }))
  }

  function renderCategory() {
    switch (section) {
      case 'privacy':
        return <SectionCard title="Account visibility">
          <div className="settings-visibility">
            {['Public', 'Private'].map((option) => <button key={option} className={(isPrivateAccount === (option === 'Private') ? 'is-selected' : '')} type="button" aria-pressed={isPrivateAccount === (option === 'Private')} onClick={() => onPrivateAccountChange(option === 'Private')}><strong>{option}</strong><small>{option === 'Public' ? 'Anyone can view your profile and public content.' : 'Only approved people can view your profile and content.'}</small></button>)}
          </div>
          <OptionRow title="Profile visibility" description="Who can find and view your profile." value={privacy.profile} onChange={(value) => toggleObject(setPrivacy, 'profile', value)} />
          <OptionRow title="Content visibility" description="Who can see the content you share." value={privacy.content} onChange={(value) => toggleObject(setPrivacy, 'content', value)} />
          <OptionRow title="Mentions" description="Who can mention you in a post." value={privacy.mentions} onChange={(value) => toggleObject(setPrivacy, 'mentions', value)} options={['Everyone', 'People you follow', 'No one']} />
          <OptionRow title="Who can interact with you" description="Set who can start a conversation." value={privacy.interactions} onChange={(value) => toggleObject(setPrivacy, 'interactions', value)} options={['Everyone', 'People you follow', 'No one']} />
        </SectionCard>
      case 'account':
        return <><SectionCard title="Your account">
          <div className="settings-account-field"><span>Name</span><strong>{profile.name}</strong></div>
          <div className="settings-account-field"><span>Username</span><strong>@{profile.username}</strong></div>
          <div className="settings-account-field"><span>Email or phone</span><strong className="is-muted">Not connected in this preview</strong></div>
          <button type="button" className="settings-link-button" onClick={onOpenProfile}>Edit profile <Icon name="chevron" size={15} /></button>
        </SectionCard>
        <SectionCard title="Account type">
          <div className="settings-visibility settings-visibility--compact">{['Public', 'Private'].map((option) => <button key={option} className={(isPrivateAccount === (option === 'Private') ? 'is-selected' : '')} type="button" aria-pressed={isPrivateAccount === (option === 'Private')} onClick={() => onPrivateAccountChange(option === 'Private')}><strong>{option}</strong><small>{option === 'Public' ? 'Open to everyone.' : 'Only approved people.'}</small></button>)}</div>
        </SectionCard>
        <SectionCard title="Admin privileges">
          {isAdmin
            ? <div className="settings-admin-active"><Icon name="admin" size={18} /><span><strong>Admin access is active</strong><small>The Admin page is available in your navigation. Review reports and account information there.</small></span></div>
            : !adminPasswordOpen
              ? <button className="settings-link-button" type="button" onClick={() => setAdminPasswordOpen(true)}>Become an admin</button>
              : <form className="settings-admin-promotion" onSubmit={async (event) => {
              event.preventDefault()
              setAdminPromotionError('')
              setAdminPromoting(true)
              try {
                await onAdminPromote?.(adminPassword)
                setAdminPassword('')
                setAdminPasswordOpen(false)
                setAdminPasswordVisible(false)
              } catch (error) {
                setAdminPromotionError(error.message || 'Admin access could not be enabled.')
              } finally {
                setAdminPromoting(false)
              }
            }}>
              <div className="settings-admin-password">
                <input type={adminPasswordVisible ? 'text' : 'password'} aria-label="Password" autoComplete="current-password" maxLength={256} value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} required />
                <button type="button" aria-label={adminPasswordVisible ? 'Hide password' : 'Show password'} aria-pressed={adminPasswordVisible} onClick={() => setAdminPasswordVisible((visible) => !visible)}><Icon name={adminPasswordVisible ? 'eye-off' : 'eye'} size={17} /></button>
              </div>
              {adminPromotionError && <p className="profile-field__error" role="alert">{adminPromotionError}</p>}
              <button className="settings-link-button" type="submit" disabled={adminPromoting || !adminPassword}>{adminPromoting ? 'Checking…' : 'Continue'}</button>
            </form>}
        </SectionCard></>
      case 'theme':
        return <><SectionCard title="Experience"><p className="settings-section-intro">Choose the scene behind your SONRISETALK experience.</p><div className="settings-theme-choices">
          {[{ id: 'default', title: 'Default', description: 'The original SONRISETALK background.' }, { id: 'underwater', title: 'Underwater', description: 'Cool blue water and softly swimming white fish.' }].map((option) => <button type="button" key={option.id} className={`settings-theme-choice settings-theme-choice--${option.id}${sceneTheme === option.id ? ' is-selected' : ''}`} aria-pressed={sceneTheme === option.id} onClick={() => onSceneThemeChange?.(option.id)}><span className="settings-theme-choice__preview"><i /><i /><i />{option.id === 'underwater' && <span className="settings-theme-choice__fish" aria-hidden="true">◁</span>}</span><strong>{option.title}</strong><small>{option.description}</small></button>)}
        </div></SectionCard><SectionCard title="Color scheme"><div className="settings-theme-choices">
          {['dark', 'light'].map((option) => <button type="button" key={option} className={`settings-theme-choice settings-theme-choice--${option}${theme === option ? ' is-selected' : ''}`} aria-pressed={theme === option} onClick={() => onThemeChange(option)}><span className="settings-theme-choice__preview"><i /><i /><i /></span><strong>{option === 'dark' ? 'Dark' : 'Light'}</strong><small>{option === 'dark' ? 'SONRISETALK dark interface.' : 'Clean white SONRISETALK interface.'}</small></button>)}
        </div></SectionCard></>
      case 'ai':
        return <><SectionCard title="What SONRISE AI can access">
          <p className="settings-section-intro">Choose what SONRISE AI can access when helping you.</p>
          <SwitchRow title="Profile" description="Allow SONRISE AI to use your profile information for more personalized help." checked={aiPermissions.profile} onChange={(value) => onAIPermissionsChange((current) => ({ ...current, profile: value }))} />
          <SwitchRow title="Posts" description="Allow SONRISE AI to use your posts when helping you." checked={aiPermissions.posts} onChange={(value) => onAIPermissionsChange((current) => ({ ...current, posts: value }))} />
          <SwitchRow title="Messages" description="Allow access to messages when you ask SONRISE AI to help with them." checked={aiPermissions.messages} onChange={(value) => onAIPermissionsChange((current) => ({ ...current, messages: value }))} />
          <SwitchRow title="Activity" description="Allow SONRISE AI to use your activity for personalization." checked={aiPermissions.activity} onChange={(value) => onAIPermissionsChange((current) => ({ ...current, activity: value }))} />
        </SectionCard><div className="settings-reassurance"><Icon name="shield" size={17} /><span>SONRISE AI only uses information you allow.</span></div></>
      case 'history':
        return <HistoryPanel history={history} onClear={() => setConfirmClear(true)} />
      case 'activity':
        return <SectionCard title="Activity controls"><p className="settings-section-intro">These controls will be available when activity history is connected.</p>
          <SwitchRow title="Viewed Reels" description="Keep a note when you view a Reel." checked={historyControls.reels} onChange={(value) => toggleObject(setHistoryControls, 'reels', value)} />
          <SwitchRow title="Searches" description="Include recent searches in history." checked={historyControls.searches} onChange={(value) => toggleObject(setHistoryControls, 'searches', value)} />
          <SwitchRow title="Profile visits" description="Keep a note of profiles you visit." checked={historyControls.profileVisits} onChange={(value) => toggleObject(setHistoryControls, 'profileVisits', value)} />
        </SectionCard>
      case 'security':
        return <SectionCard title="Account safety">
          {['Password', 'Login activity', 'Devices'].map((label) => <button className="settings-placeholder-row" key={label} type="button" onClick={() => setNotice(`${label} settings will be available in a future version.`)}><span><strong>{label}</strong><small>Available when account services are connected.</small></span><Icon name="chevron" size={16} /></button>)}
          <SwitchRow title="Two-factor authentication" description="An extra layer of security. Preview only; no security changes are made." checked={securityToggles.twoFactor} onChange={(value) => toggleObject(setSecurityToggles, 'twoFactor', value)} />
        </SectionCard>
      case 'notifications':
        return <SectionCard title="Notification preferences">
          {Object.entries({ push: 'Push notifications', likes: 'Likes', comments: 'Comments', messages: 'Messages', mentions: 'Mentions' }).map(([key, label]) => <SwitchRow key={key} title={label} description={key === 'push' ? 'Allow notifications on this device.' : `Let me know when someone ${key === 'likes' ? 'likes my post' : key === 'comments' ? 'comments on my post' : key === 'messages' ? 'sends me a message' : 'mentions me'}.`} checked={notifications[key]} onChange={(value) => toggleObject(setNotifications, key, value)} />)}
        </SectionCard>
      case 'language':
        return <SectionCard title="Language"><div className="settings-option-row"><span><strong>Display language</strong><small>Choose a language for SONRISETALK.</small></span><select aria-label="Display language" value={language} onChange={(event) => setLanguage(event.target.value)}>{['English', 'Español', 'Français', 'Deutsch', '日本語'].map((option) => <option key={option}>{option}</option>)}</select></div></SectionCard>
      default:
        return null
    }
  }

  return (
    <div className="settings-page">
      {section ? (
        <>
          <button className="settings-back" type="button" onClick={() => { setSection(null); setNotice('') }}><Icon name="back" size={16} /> Settings</button>
          <header className="settings-header settings-header--section"><span className="settings-eyebrow">SETTINGS</span><h1>{settingsCopy[section][0]}</h1><p>{settingsCopy[section][1]}</p></header>
          {renderCategory()}
        </>
      ) : (
        <>
          <header className="settings-header"><span className="settings-eyebrow"><span /> YOUR SPACE</span><h1>Settings</h1><p>Manage your SONRISETALK experience.</p></header>
          <div className="settings-category-list">{categories.map((group) => <section className="settings-category-group" key={group.group}><h2>{group.group}</h2>{group.items.map((item) => <SettingRow key={item.id} {...item} onClick={() => setSection(item.id)} />)}</section>)}</div>
        </>
      )}
      {notice && <p className="settings-inline-notice" role="status">{notice}</p>}
      {confirmClear && <ConfirmDialog title="Clear your history?" description="This will remove the local history shown here." confirmLabel="Clear history" onCancel={() => setConfirmClear(false)} onConfirm={() => { setHistory([]); setConfirmClear(false) }} />}
    </div>
  )
}
