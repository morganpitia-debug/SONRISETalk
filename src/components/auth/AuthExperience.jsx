import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/max'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import BrandMark from '../BrandMark.jsx'
import Icon from '../Icon.jsx'
import {
  getPasskeyRecoveryOptions,
  getPasskeyRegistrationOptions,
  isApiEnabled,
  loginAccount,
  registerAccount,
  resetPassword,
  verifyPasskeyRecovery,
  verifyPasskeyRegistration,
} from '../../api/auth.js'

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' })
const countries = getCountries()
  .map((code) => ({ code, name: countryNames.of(code), callingCode: getCountryCallingCode(code) }))
  .filter((country) => country.name && country.name !== country.code)
  .sort((first, second) => first.name.localeCompare(second.name))

function countryFlag(code) {
  return String.fromCodePoint(...code.toUpperCase().split('').map((letter) => letter.charCodeAt(0) + 127397))
}

function ThemeToggle({ theme, onThemeChange }) {
  const light = theme === 'light'
  return (
    <button className="auth-theme-toggle" type="button" aria-label={`Switch to ${light ? 'dark' : 'light'} theme`} onClick={() => onThemeChange(light ? 'dark' : 'light')}>
      <Icon name={light ? 'moon' : 'sun'} size={17} />
      <span>{light ? 'Light' : 'Dark'}</span>
    </button>
  )
}

function AuthLayout({ theme, onThemeChange, children, step }) {
  return (
    <main className={`auth-page${theme === 'light' ? ' is-light' : ''}`}>
      <header className="auth-header">
        <a className="auth-brand" href="#auth" aria-label="Sonrisetalk">
          <BrandMark size={35} />
          <span>SONRISE<span>TALK</span></span>
        </a>
        <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
      </header>
      <div className="auth-content">
        <section className="auth-card" key={step}>
          {children}
        </section>
      </div>
      <footer className="auth-footer">
        <span>A NEW KIND OF TOGETHER</span>
      </footer>
    </main>
  )
}

function AuthHeading({ title, subtitle }) {
  return <div className="auth-heading"><h1>{title}</h1><p>{subtitle}</p></div>
}

function SignupProgress({ step }) {
  return (
    <div className="auth-progress" aria-label={`Step ${step} of 6`}>
      <span className="auth-progress__label">STEP {step} OF 6</span>
      <div className="auth-progress__track">{Array.from({ length: 6 }, (_, index) => <span key={index} className={index < step ? 'is-complete' : ''} />)}</div>
    </div>
  )
}

function FieldError({ children }) {
  return children ? <small className="auth-field-error" role="alert">{children}</small> : null
}

function PasswordInput({ label, value, onChange, id }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input-wrap">
        <input id={id} type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={id === 'login-password' ? 'current-password' : 'new-password'} />
        <button className="auth-password-toggle" type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((current) => !current)}>
          <Icon name={visible ? 'eye-off' : 'eye'} size={17} />
        </button>
      </div>
    </div>
  )
}

function CountryPicker({ country, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const visibleCountries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return countries
    return countries.filter(({ name, code, callingCode }) => `${name} ${code} +${callingCode}`.toLocaleLowerCase().includes(normalized))
  }, [query])

  return (
    <div className="auth-country-picker">
      <span className="auth-field__label">Choose your country</span>
      <button className="auth-country-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen((current) => !current); setQuery('') }}>
        <span>{countryFlag(country.code)} {country.name}</span><strong>+{country.callingCode}</strong><Icon name="chevron" size={15} />
      </button>
      {open && <div className="auth-country-menu">
        <input autoFocus type="search" aria-label="Search countries" placeholder="Search countries or calling codes" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div role="listbox" aria-label="Countries">
          {visibleCountries.map((option) => (
            <button type="button" role="option" aria-selected={option.code === country.code} key={option.code} onClick={() => { onChange(option); setOpen(false); setQuery('') }}>
              <span>{countryFlag(option.code)} {option.name}</span><small>+{option.callingCode}</small>
            </button>
          ))}
          {!visibleCountries.length && <p>No countries found.</p>}
        </div>
      </div>}
    </div>
  )
}

function validDate(day, month, year) {
  if (!day || !month || !year) return false
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) && date <= new Date()
}

export default function AuthExperience({ theme, onThemeChange, onAuthenticated, isAddingAccount, onCancelAddAccount }) {
  const [screen, setScreen] = useState('login')
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ method: 'email', email: '', phone: '', country: countries.find(({ code }) => code === 'RW') || countries[0], name: '', username: '', day: '', month: '', year: '', photo: '', password: '', confirmPassword: '', loginIdentifier: '', loginPassword: '', resetPassword: '', resetConfirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [recoveryStatus, setRecoveryStatus] = useState('')
  const [recoveryProfile, setRecoveryProfile] = useState(null)
  const [recoveryToken, setRecoveryToken] = useState('')
  const [passkeySetupStatus, setPasskeySetupStatus] = useState('')
  const [authError, setAuthError] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [authenticatedUser, setAuthenticatedUser] = useState(null)
  const apiEnabled = isApiEnabled()

  useEffect(() => () => {
    if (form.photo.startsWith('blob:')) URL.revokeObjectURL(form.photo)
  }, [form.photo])

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '' }))
  }

  function startSignup() {
    setErrors({})
    setRecoveryStatus('')
    setScreen('signup')
    setStep(1)
  }

  function validateContact() {
    if (form.method === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) {
        setErrors({ email: 'Enter a valid email address. Please check your email address.' })
        return false
      }
      return true
    }
    const localNumber = form.phone.trim()
    if (!localNumber || localNumber.startsWith('+') || localNumber.startsWith('00')) {
      setErrors({ phone: `Enter a valid phone number for ${form.country.name}. Enter the local number without the country code.` })
      return false
    }
    const parsed = parsePhoneNumberFromString(localNumber, form.country.code)
    if (!parsed?.isValid() || parsed.country !== form.country.code) {
      setErrors({ phone: `Enter a valid phone number for ${form.country.name}.` })
      return false
    }
    return true
  }

  function continueSignup() {
    setErrors({})
    if (step === 1 && !validateContact()) return
    if (step === 2 && !form.name.trim()) return setErrors({ name: 'Enter your full name.' })
    if (step === 3) {
      const username = form.username.trim().replace(/^@/, '').toLowerCase()
      if (!username) return setErrors({ username: 'Username is required.' })
      if (username.length < 3) return setErrors({ username: 'Username is too short. Use at least 3 characters.' })
      if (!/^[a-z0-9._]+$/.test(username)) return setErrors({ username: 'Use letters, numbers, periods, or underscores.' })
      update('username', username)
    }
    if (step === 4 && !validDate(form.day, form.month, form.year)) return setErrors({ birthday: 'Choose a valid date of birth.' })
    setStep((current) => Math.min(6, current + 1))
  }

  const selectedCountry = form.country
  const normalizedUsername = form.username.trim().replace(/^@/, '').toLowerCase()
  const usernameStatus = !normalizedUsername
    ? ''
    : normalizedUsername.length < 3
      ? 'Use at least 3 characters.'
      : !/^[a-z0-9._]+$/.test(normalizedUsername)
        ? 'Use letters, numbers, periods, or underscores.'
        : 'Format looks good. Availability will be checked when account services are connected.'
  const parsedPhone = form.phone.trim()
    ? parsePhoneNumberFromString(form.phone.trim(), selectedCountry.code)
    : null
  const phonePreview = /^(\+|00)/.test(form.phone.trim())
    ? parsedPhone?.formatInternational() || form.phone.trim()
    : parsedPhone?.country === selectedCountry.code
      ? parsedPhone.formatInternational()
      : `+${selectedCountry.callingCode} ${form.phone || '7XX XXX XXX'}`
  const passwordStatus = !form.password ? '' : form.password.length < 8 ? 'Too short — use at least 8 characters.' : form.confirmPassword && form.confirmPassword !== form.password ? "Passwords don't match." : form.confirmPassword ? 'Passwords match.' : 'Good — add at least 8 characters.'

  function submitLogin(event) {
    event.preventDefault()
    const nextErrors = {}
    if (!form.loginIdentifier.trim()) nextErrors.loginIdentifier = 'Enter your email, phone or username.'
    if (!form.loginPassword) nextErrors.loginPassword = 'Enter your password.'
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setAuthError('')
    if (apiEnabled) {
      setAuthSubmitting(true)
      loginAccount({ identifier: form.loginIdentifier, password: form.loginPassword })
        .then(({ data }) => {
          setAuthToken(data.token)
          setAuthenticatedUser(data.user)
          setScreen('remember')
        })
        .catch((error) => setAuthError(error.message || 'Sign-in failed.'))
        .finally(() => setAuthSubmitting(false))
      return
    }
    setScreen('remember')
  }

  function openPasswordRecovery() {
    setRecoveryProfile(null)
    setRecoveryToken('')
    setRecoveryStatus('')
    setScreen('recovery')
  }

  async function handlePasskeyRecovery() {
    if (!apiEnabled) {
      setRecoveryStatus('Passkey recovery requires the account service to be connected.')
      return
    }

    setAuthSubmitting(true)
    setRecoveryStatus('Follow your device prompt to verify your passkey…')
    try {
      const { data: ceremony } = await getPasskeyRecoveryOptions()
      const response = await startAuthentication({ optionsJSON: ceremony.options })
      const { data } = await verifyPasskeyRecovery({
        challengeId: ceremony.challengeId,
        response,
      })
      setRecoveryProfile(data.profile)
      setRecoveryToken(data.token)
      setRecoveryStatus('')
      setScreen('recovery-profile')
    } catch (error) {
      setRecoveryStatus(error.message || 'Passkey verification failed. Try again.')
    } finally {
      setAuthSubmitting(false)
    }
  }

  async function handlePasskeySetup() {
    if (!apiEnabled || !authToken) {
      setPasskeySetupStatus('Sign in to set up a passkey for password recovery.')
      return
    }

    setAuthSubmitting(true)
    setPasskeySetupStatus('Follow your device prompt to create a passkey…')
    try {
      const { data: ceremony } = await getPasskeyRegistrationOptions(authToken)
      const response = await startRegistration({ optionsJSON: ceremony.options })
      await verifyPasskeyRegistration({
        challengeId: ceremony.challengeId,
        response,
        token: authToken,
      })
      setAuthenticatedUser((user) => ({ ...user, hasPasskey: true }))
      setPasskeySetupStatus('Passkey set up. You can now recover this account without email or phone.')
    } catch (error) {
      setPasskeySetupStatus(error.message || 'Passkey setup failed. Try again.')
    } finally {
      setAuthSubmitting(false)
    }
  }

  function submitPasswordReset(event) {
    event.preventDefault()
    const token = recoveryToken
    const password = form.resetPassword
    if (!token) {
      setRecoveryStatus('A recovery token is required before resetting your password.')
      return
    }
    if (password.length < 8) {
      setRecoveryStatus('Choose a password with at least 8 characters.')
      return
    }
    if (password !== form.resetConfirmPassword) {
      setRecoveryStatus('Your new passwords do not match.')
      return
    }
    setRecoveryStatus('Resetting your password…')
    resetPassword({ token, password })
      .then(({ data }) => {
        setRecoveryStatus(data?.message || 'Your password was reset successfully.')
        setRecoveryToken('')
        setScreen('recovery-complete')
      })
      .catch((error) => setRecoveryStatus(error.message || 'Password reset failed.'))
  }

  function finishSignup(event) {
    event.preventDefault()
    const nextErrors = {}
    if (form.password.length < 8) nextErrors.password = 'Password must be at least 8 characters.'
    if (form.confirmPassword !== form.password) nextErrors.confirmPassword = "Passwords don't match."
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setAuthError('')
    if (apiEnabled) {
      const parsedBirthday = form.year && form.month && form.day
        ? new Date(Date.UTC(Number(form.year), Number(form.month) - 1, Number(form.day))).toISOString()
        : undefined
      const parsedPhone = form.method === 'phone'
        ? parsePhoneNumberFromString(form.phone.trim(), form.country.code)?.number
        : undefined
      setAuthSubmitting(true)
      registerAccount({
        method: form.method,
        email: form.method === 'email' ? form.email.trim() : undefined,
        phone: parsedPhone,
        username: form.username.trim().replace(/^@+/, '').toLowerCase(),
        name: form.name.trim(),
        birthday: parsedBirthday,
        password: form.password,
      })
        .then(({ data }) => {
          setAuthToken(data.token)
          setAuthenticatedUser(data.user)
          setScreen('success')
        })
        .catch((error) => setAuthError(error.message || 'Account creation failed.'))
        .finally(() => setAuthSubmitting(false))
      return
    }
    setScreen('success')
  }

  return (
    <AuthLayout theme={theme} onThemeChange={onThemeChange} step={screen === 'signup' ? step : screen}>
      {screen === 'login' && <form className="auth-form" onSubmit={submitLogin} noValidate>
        {isAddingAccount && <button className="auth-back-button" type="button" aria-label="Return to app" onClick={onCancelAddAccount}><Icon name="back" size={16} /><span>Return</span></button>}
        <div className="auth-brand-mark"><BrandMark size={27} /></div>
        <AuthHeading title="Welcome back" subtitle="Log in to continue to Sonrisetalk." />
        <label className="auth-field" htmlFor="login-identifier"><span>Email, phone or username</span><input id="login-identifier" type="text" autoComplete="username" value={form.loginIdentifier} onChange={(event) => update('loginIdentifier', event.target.value)} /><FieldError>{errors.loginIdentifier}</FieldError></label>
        <div><PasswordInput id="login-password" label="Password" value={form.loginPassword} onChange={(value) => update('loginPassword', value)} /><FieldError>{errors.loginPassword}</FieldError></div>
        <div className="auth-forgot-row"><button type="button" onClick={openPasswordRecovery}>Forgot password?</button></div>
        {authError && <p className="auth-notice" role="alert">{authError}</p>}
        <button className="auth-primary" type="submit" disabled={authSubmitting}>{authSubmitting ? 'Signing in…' : 'Log in'}</button>
        <p className="auth-switch">Don't have an account? <button type="button" onClick={startSignup}>Sign up</button></p>
      </form>}

      {screen === 'recovery' && <div className="auth-form">
        <button className="auth-back-button" type="button" aria-label="Back to login" onClick={() => setScreen('login')}><Icon name="back" size={16} /></button>
        <div className="auth-brand-mark"><BrandMark size={27} /></div>
        <AuthHeading title="Recover your account" subtitle="Use the passkey you registered on this device to verify your account." />
        <div className="auth-passkey-mark" aria-hidden="true"><Icon name="privacy" size={26} /></div>
        <p className="auth-verification-note">Your device may use Face ID, Windows Hello, a fingerprint, or its secure PIN. With a passkey, biometric data stays on your device.</p>
        <button className="auth-primary" type="button" onClick={handlePasskeyRecovery} disabled={authSubmitting || !apiEnabled}>{authSubmitting ? 'Verifying…' : 'Continue with passkey'}</button>
        {recoveryStatus && <p className="auth-notice" role="status">{recoveryStatus}</p>}
        {!apiEnabled && <p className="auth-notice" role="status">Connect the account service to use passkey recovery.</p>}
        <p className="auth-switch">Remember your password? <button type="button" onClick={() => setScreen('login')}>Log in</button></p>
      </div>}

      {screen === 'recovery-profile' && recoveryProfile && <div className="auth-form auth-success">
        <div className="auth-brand-mark"><BrandMark size={27} /></div>
        <AuthHeading title="Is this your account?" subtitle="Passkey verification found this profile. Confirm it before choosing a new password." />
        <div className="auth-recovery-profile">
          <div className="auth-recovery-profile__photo">{recoveryProfile.profilePicture ? <img src={recoveryProfile.profilePicture} alt="" /> : <BrandMark size={34} />}</div>
          <strong>{recoveryProfile.name}</strong>
          <span>@{recoveryProfile.username}</span>
        </div>
        <button className="auth-primary" type="button" onClick={() => { setRecoveryStatus(''); setScreen('recovery-password') }}>Yes, continue</button>
        <button className="auth-secondary auth-remember-later" type="button" onClick={() => { setRecoveryProfile(null); setRecoveryToken(''); setRecoveryStatus(''); setScreen('recovery') }}>This is not my account</button>
      </div>}

      {screen === 'recovery-password' && <form className="auth-form" onSubmit={submitPasswordReset} noValidate>
        <button className="auth-back-button" type="button" aria-label="Back to profile confirmation" onClick={() => setScreen('recovery-profile')}><Icon name="back" size={16} /></button>
        <AuthHeading title="Choose a new password" subtitle="Your passkey verified the account. Choose a password with at least 8 characters." />
        <div className="auth-password-fields">
          <PasswordInput id="recovery-new-password" label="New password" value={form.resetPassword} onChange={(value) => update('resetPassword', value)} />
          <PasswordInput id="recovery-confirm-password" label="Confirm new password" value={form.resetConfirmPassword} onChange={(value) => update('resetConfirmPassword', value)} />
        </div>
        {recoveryStatus && <p className="auth-notice" role="status">{recoveryStatus}</p>}
        <button className="auth-primary" type="submit" disabled={authSubmitting}>{authSubmitting ? 'Resetting password…' : 'Reset password'}</button>
      </form>}

      {screen === 'recovery-complete' && <div className="auth-form auth-success">
        <div className="auth-success__mark"><BrandMark size={40} /></div>
        <AuthHeading title="Password updated" subtitle="Your password was reset and other active sessions were signed out." />
        <button className="auth-primary" type="button" onClick={() => { setRecoveryProfile(null); setRecoveryStatus(''); setScreen('login') }}>Back to log in</button>
      </div>}

      {screen === 'signup' && <div className="auth-form">
        <SignupProgress step={step} />
        {step === 1 && <>
          <AuthHeading title="Create your Sonrisetalk account" subtitle="Enter your email or phone number to get started." />
          <div className="auth-choice" role="tablist" aria-label="Contact method">
            {['email', 'phone'].map((method) => <button key={method} type="button" role="tab" aria-selected={form.method === method} className={form.method === method ? 'is-active' : ''} onClick={() => { update('method', method); setErrors({}) }}>{method === 'email' ? 'Email' : 'Phone'}</button>)}
          </div>
          {form.method === 'email' ? <label className="auth-field" htmlFor="signup-email"><span>Email address</span><input id="signup-email" type="email" autoComplete="email" placeholder="name@example.com" value={form.email} onChange={(event) => update('email', event.target.value)} /><FieldError>{errors.email}</FieldError></label> : <>
            <CountryPicker country={selectedCountry} onChange={(country) => update('country', country)} />
            <label className="auth-field" htmlFor="signup-phone"><span>Phone number</span><input id="signup-phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="Enter local number" value={form.phone} onChange={(event) => update('phone', event.target.value)} /><FieldError>{errors.phone}</FieldError></label>
            <p className="auth-phone-preview">Your number: <strong>{phonePreview}</strong></p>
          </>}
          <button className="auth-primary" type="button" onClick={continueSignup}>Continue</button>
          <p className="auth-verification-note">This checks the format only. We won't verify ownership until account services are available.</p>
          <p className="auth-switch">Already have an account? <button type="button" onClick={() => { setErrors({}); setScreen('login') }}>Log in</button></p>
        </>}
        {step === 2 && <>
          <AuthHeading title="What's your name?" subtitle="Use the name people know you by." />
          <label className="auth-field" htmlFor="signup-name"><span>Full name</span><input id="signup-name" autoComplete="name" value={form.name} onChange={(event) => update('name', event.target.value)} /><FieldError>{errors.name}</FieldError></label>
          <div className="auth-actions"><button className="auth-secondary" type="button" onClick={() => setStep(1)}>Back</button><button className="auth-primary" type="button" onClick={continueSignup}>Continue</button></div>
        </>}
        {step === 3 && <>
          <AuthHeading title="Choose your username" subtitle="This is how people will find you on Sonrisetalk." />
          <label className="auth-field" htmlFor="signup-username"><span>Username</span><div className="auth-username-input"><span>@</span><input id="signup-username" autoComplete="username" value={form.username.replace(/^@/, '')} onChange={(event) => update('username', event.target.value.replace(/^@/, ''))} /></div><FieldError>{errors.username}</FieldError></label>
          <p className={`auth-username-preview${usernameStatus.startsWith('Format looks good') ? ' is-available' : ''}`}>Your profile will appear as <strong>@{form.username.replace(/^@/, '') || 'username'}</strong>{usernameStatus && <span> · {usernameStatus}</span>}</p>
          <div className="auth-actions"><button className="auth-secondary" type="button" onClick={() => setStep(2)}>Back</button><button className="auth-primary" type="button" onClick={continueSignup}>Continue</button></div>
        </>}
        {step === 4 && <>
          <AuthHeading title="When were you born?" subtitle="Your birthday helps us provide the right experience for your account." />
          <div className="auth-birthday-fields">
            <label className="auth-field"><span>Day</span><select value={form.day} onChange={(event) => update('day', event.target.value)}><option value="">Day</option>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
            <label className="auth-field"><span>Month</span><select value={form.month} onChange={(event) => update('month', event.target.value)}><option value="">Month</option>{['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
            <label className="auth-field"><span>Year</span><select value={form.year} onChange={(event) => update('year', event.target.value)}><option value="">Year</option>{Array.from({ length: 120 }, (_, index) => new Date().getFullYear() - index).map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          </div>
          <FieldError>{errors.birthday}</FieldError>
          <div className="auth-actions"><button className="auth-secondary" type="button" onClick={() => setStep(3)}>Back</button><button className="auth-primary" type="button" onClick={continueSignup}>Continue</button></div>
        </>}
        {step === 5 && <>
          <AuthHeading title="Add a profile picture" subtitle="Help people recognize you." />
          <div className="auth-photo-preview">{form.photo ? <img src={form.photo} alt="Profile preview" /> : <BrandMark size={45} />}</div>
          <input className="auth-file-input" id="signup-photo" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) update('photo', URL.createObjectURL(file)) }} />
          <label className="auth-photo-button" htmlFor="signup-photo">Add photo</label>
          <div className="auth-actions auth-actions--profile"><button className="auth-secondary" type="button" onClick={() => setStep(4)}>Back</button><button className="auth-secondary" type="button" onClick={() => setStep(6)}>Skip for now</button><button className="auth-primary" type="button" onClick={() => setStep(6)}>Continue</button></div>
        </>}
        {step === 6 && <form onSubmit={finishSignup} noValidate>
          <AuthHeading title="Create a password" subtitle="Choose a password for your account." />
          <div className="auth-password-fields"><div><PasswordInput id="signup-password" label="Password" value={form.password} onChange={(value) => update('password', value)} /><FieldError>{errors.password}</FieldError></div><div><PasswordInput id="signup-confirm-password" label="Confirm password" value={form.confirmPassword} onChange={(value) => update('confirmPassword', value)} /><FieldError>{errors.confirmPassword}</FieldError></div></div>
          {passwordStatus && <p className={`auth-password-feedback${passwordStatus.startsWith('Too short') || passwordStatus.startsWith('Passwords don') ? ' is-error' : ''}`}>{passwordStatus}</p>}
          {authError && <p className="auth-notice" role="alert">{authError}</p>}
          <div className="auth-actions"><button className="auth-secondary" type="button" onClick={() => setStep(5)}>Back</button><button className="auth-primary" type="submit" disabled={authSubmitting}>{authSubmitting ? 'Creating account…' : 'Create account'}</button></div>
        </form>}
      </div>}

      {screen === 'success' && <div className="auth-form auth-success">
        <div className="auth-success__mark"><BrandMark size={40} /></div>
        <AuthHeading title="Welcome to Sonrisetalk!" subtitle="Your account is ready." />
        <div className="auth-success__summary"><strong>{form.name || 'Your profile'}</strong><span>@{form.username || 'username'}</span></div>
        {authenticatedUser?.hasPasskey === false && <div className="auth-passkey-prompt">
          <strong>Set up password recovery</strong>
          <p>Register a device passkey now so you can recover your account without email or phone.</p>
          <button className="auth-secondary" type="button" onClick={handlePasskeySetup} disabled={authSubmitting}>{authSubmitting ? 'Setting up…' : 'Set up passkey'}</button>
          {passkeySetupStatus && <p className="auth-notice" role="status">{passkeySetupStatus}</p>}
        </div>}
        <button className="auth-primary" type="button" onClick={() => setScreen('remember')}>Continue to Sonrisetalk</button>
      </div>}

      {screen === 'remember' && <div className="auth-form auth-success">
        <div className="auth-success__mark"><BrandMark size={40} /></div>
        <AuthHeading title="Save your login?" subtitle="Choose whether Sonrisetalk should remember your login on this device." />
        {authenticatedUser?.hasPasskey === false && <div className="auth-passkey-prompt">
          <strong>Enable password recovery</strong>
          <p>A passkey lets your device verify you without email, phone, or username. Your biometric stays on your device.</p>
          <button className="auth-secondary" type="button" onClick={handlePasskeySetup} disabled={authSubmitting}>{authSubmitting ? 'Setting up…' : 'Set up a passkey'}</button>
          {passkeySetupStatus && <p className="auth-notice" role="status">{passkeySetupStatus}</p>}
        </div>}
        {authenticatedUser?.hasPasskey && <p className="auth-notice" role="status">A passkey is set up for account recovery.</p>}
        <button className="auth-primary" type="button" onClick={() => onAuthenticated(true, authToken, authenticatedUser)}>Save login on this device</button>
        <button className="auth-secondary auth-remember-later" type="button" onClick={() => onAuthenticated(false, authToken, authenticatedUser)}>Not now</button>
        <p className="auth-verification-note">You can log out at any time. {apiEnabled ? 'Your sign-in is protected by an account session.' : 'This preview login is stored on this device.'}</p>
      </div>}
    </AuthLayout>
  )
}
