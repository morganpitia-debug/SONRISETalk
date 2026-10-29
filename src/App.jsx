import { useCallback, useEffect, useState } from 'react'
import AppShell from './components/AppShell.jsx'
import AuthExperience from './components/auth/AuthExperience.jsx'
import { isApiEnabled, logoutAccount } from './api/auth.js'

function readStoredAccount() {
  const stored = window.localStorage.getItem('sonrisetalk-auth-profile')
    || window.sessionStorage.getItem('sonrisetalk-auth-profile')
  if (!stored) return null
  try {
    return JSON.parse(stored)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function readSavedAccounts() {
  const stored = window.localStorage.getItem('sonrisetalk-saved-accounts')
  const accounts = stored ? (() => {
    try {
      const saved = JSON.parse(stored)
      return Array.isArray(saved) ? saved : []
    } catch (error) {
      if (error instanceof SyntaxError) return []
      throw error
    }
  })() : []
  const validAccounts = accounts.filter((item) => (
    item
    && typeof item.id === 'string'
    && typeof item.username === 'string'
    && typeof item.token === 'string'
  ))
  const legacyToken = window.localStorage.getItem('sonrisetalk-auth-token')
  const legacyProfile = window.localStorage.getItem('sonrisetalk-auth-profile')
  if (window.localStorage.getItem('sonrisetalk-session') === 'saved' && legacyToken && legacyProfile) {
    try {
      const user = JSON.parse(legacyProfile)
      if (user?.id && user.username && !validAccounts.some((item) => item.id === user.id)) {
        validAccounts.unshift({
          id: user.id,
          username: user.username,
          name: user.name || user.username,
          profilePicture: user.profilePicture || null,
          token: legacyToken,
        })
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return validAccounts
}

export default function App() {
  const [activePage, setActivePage] = useState('Home')
  const apiEnabled = isApiEnabled()
  const [authenticated, setAuthenticated] = useState(() => apiEnabled
    ? Boolean(window.localStorage.getItem('sonrisetalk-auth-token'))
    : window.localStorage.getItem('sonrisetalk-session') === 'saved')
  const [account, setAccount] = useState(readStoredAccount)
  const [savedAccounts, setSavedAccounts] = useState(readSavedAccounts)
  const [theme, setTheme] = useState(() => window.localStorage.getItem('sonrisetalk-theme') === 'light' ? 'light' : 'dark')
  const [sceneTheme, setSceneTheme] = useState(() => window.localStorage.getItem('sonrisetalk-scene-theme') === 'underwater' ? 'underwater' : 'default')
  const [addingAccount, setAddingAccount] = useState(false)
  const [previousSession, setPreviousSession] = useState(null)

  function completeAuthentication(remember, token, user) {
    if (remember) window.localStorage.setItem('sonrisetalk-session', 'saved')
    else window.localStorage.removeItem('sonrisetalk-session')
    window.localStorage.removeItem('sonrisetalk-auth-token')
    window.localStorage.removeItem('sonrisetalk-auth-profile')
    window.sessionStorage.removeItem('sonrisetalk-auth-token')
    window.sessionStorage.removeItem('sonrisetalk-auth-profile')
    if (token) {
      const storage = remember ? window.localStorage : window.sessionStorage
      storage.setItem('sonrisetalk-auth-token', token)
    }
    if (user) {
      const storage = remember ? window.localStorage : window.sessionStorage
      storage.setItem('sonrisetalk-auth-profile', JSON.stringify(user))
    }
    if (remember && token && user?.id && user.username) {
      const savedAccount = {
        id: user.id,
        username: user.username,
        name: user.name || user.username,
        profilePicture: user.profilePicture || null,
        token,
      }
      const updated = [savedAccount, ...savedAccounts.filter((item) => item.id !== user.id)]
      window.localStorage.setItem('sonrisetalk-saved-accounts', JSON.stringify(updated))
      setSavedAccounts(updated)
    }
    setAccount(user || null)
    setActivePage('Home')
    setAuthenticated(true)
  }

  function selectSavedAccount(username) {
    const selectedAccount = savedAccounts.find((item) => item.username.toLowerCase() === username.toLowerCase())
    if (!selectedAccount) return
    const { token, ...user } = selectedAccount
    window.localStorage.setItem('sonrisetalk-auth-token', token)
    window.localStorage.setItem('sonrisetalk-auth-profile', JSON.stringify(user))
    window.localStorage.setItem('sonrisetalk-session', 'saved')
    window.sessionStorage.removeItem('sonrisetalk-auth-token')
    window.sessionStorage.removeItem('sonrisetalk-auth-profile')
    setAccount(user)
    setActivePage('Home')
    setAuthenticated(true)
  }

  const updateSavedAccount = useCallback((updatedProfile) => {
    const stored = window.localStorage.getItem('sonrisetalk-saved-accounts')
    let current = []
    if (stored) {
      try {
        const saved = JSON.parse(stored)
        if (Array.isArray(saved)) current = saved
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
    }
    const updated = current.map((item) => item.id === updatedProfile.id
      ? { ...item, name: updatedProfile.name, username: updatedProfile.username, profilePicture: updatedProfile.profilePicture }
      : item)
    window.localStorage.setItem('sonrisetalk-saved-accounts', JSON.stringify(updated))
    setSavedAccounts(updated)
  }, [])

  async function addAccount() {
    const currentToken = window.localStorage.getItem('sonrisetalk-auth-token')
      || window.sessionStorage.getItem('sonrisetalk-auth-token')
    const currentProfile = readStoredAccount()
    setPreviousSession({ token: currentToken, profile: currentProfile, session: window.localStorage.getItem('sonrisetalk-session') })
    const currentAccountIsSaved = savedAccounts.some((item) => item.id === currentProfile?.id)
    if (currentToken && !currentAccountIsSaved) {
      try {
        await logoutAccount()
      } catch (error) {
        console.error('Could not revoke the server session:', error)
      }
    }
    window.localStorage.removeItem('sonrisetalk-session')
    window.localStorage.removeItem('sonrisetalk-auth-token')
    window.localStorage.removeItem('sonrisetalk-auth-profile')
    window.sessionStorage.removeItem('sonrisetalk-auth-token')
    window.sessionStorage.removeItem('sonrisetalk-auth-profile')
    setAccount(null)
    setActivePage('Home')
    setAddingAccount(true)
    setAuthenticated(false)
  }

  function cancelAddAccount() {
    if (previousSession) {
      if (previousSession.session) window.localStorage.setItem('sonrisetalk-session', previousSession.session)
      if (previousSession.token) window.localStorage.setItem('sonrisetalk-auth-token', previousSession.token)
      if (previousSession.profile) {
        window.localStorage.setItem('sonrisetalk-auth-profile', JSON.stringify(previousSession.profile))
        setAccount(previousSession.profile)
      }
      setAuthenticated(true)
    }
    setAddingAccount(false)
    setPreviousSession(null)
  }
  async function logout() {
    const shouldRevoke = window.localStorage.getItem('sonrisetalk-auth-token')
      || window.sessionStorage.getItem('sonrisetalk-auth-token')
    let revocationError
    if (shouldRevoke) {
      try {
        await logoutAccount()
      } catch (error) {
        revocationError = error
      }
    }
    window.localStorage.removeItem('sonrisetalk-session')
    window.localStorage.removeItem('sonrisetalk-auth-token')
    window.localStorage.removeItem('sonrisetalk-auth-profile')
    window.sessionStorage.removeItem('sonrisetalk-auth-token')
    window.sessionStorage.removeItem('sonrisetalk-auth-profile')
    setActivePage('Home')
    setAuthenticated(false)
    setAccount(null)
    if (revocationError) console.error('Could not revoke the server session:', revocationError)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('sonrisetalk-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.scene = sceneTheme
    window.localStorage.setItem('sonrisetalk-scene-theme', sceneTheme)
  }, [sceneTheme])

  if (!authenticated) return <AuthExperience theme={theme} onThemeChange={setTheme} onAuthenticated={completeAuthentication} isAddingAccount={addingAccount} onCancelAddAccount={cancelAddAccount} />
  return <AppShell key={account?.id ?? 'account-session'} activePage={activePage} onNavigate={setActivePage} theme={theme} onThemeChange={setTheme} sceneTheme={sceneTheme} onSceneThemeChange={setSceneTheme} onLogout={logout} authUser={account} savedAccounts={savedAccounts} onSelectSavedAccount={selectSavedAccount} onAddAccount={addAccount} onUpdateSavedAccount={updateSavedAccount} />
}