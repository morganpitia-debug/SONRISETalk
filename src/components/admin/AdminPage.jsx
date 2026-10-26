import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import {
  deleteAdminAccount,
  getAdminAccount,
  getAdminReports,
  getAdminUsers,
  updateAdminReport,
} from '../../api/admin.js'

function accountLabel(account) {
  return `${account.name} · @${account.username}`
}

export default function AdminPage() {
  const [section, setSection] = useState('reports')
  const [reports, setReports] = useState([])
  const [users, setUsers] = useState([])
  const [userQuery, setUserQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [nextCursor, setNextCursor] = useState(null)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [loadingAccountId, setLoadingAccountId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    if (section === 'reports') {
      getAdminReports()
        .then(({ reports: result }) => {
          if (active) setReports(result)
        })
        .catch((requestError) => {
          if (active) setError(requestError.message || 'Reports could not load.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    } else {
      setUsers([])
      setNextCursor(null)
      getAdminUsers({ query: appliedQuery })
        .then(({ users: result, nextCursor: cursor }) => {
          if (!active) return
          setUsers(result)
          setNextCursor(cursor)
        })
        .catch((requestError) => {
          if (active) setError(requestError.message || 'Accounts could not load.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }
    return () => { active = false }
  }, [appliedQuery, refreshKey, section])

  async function openAccount(userId) {
    setSelectedAccount(null)
    setLoadingAccountId(userId)
    setActionError('')
    try {
      const { account } = await getAdminAccount(userId)
      setSelectedAccount(account)
    } catch (requestError) {
      setActionError(requestError.message || 'Account details could not load.')
    } finally {
      setLoadingAccountId(null)
    }
  }

  async function loadMoreUsers() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const { users: nextUsers, nextCursor: cursor } = await getAdminUsers({ query: appliedQuery, cursor: nextCursor })
      setUsers((current) => [...current, ...nextUsers])
      setNextCursor(cursor)
    } catch (requestError) {
      setActionError(requestError.message || 'More accounts could not load.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function closeReport(reportId, status) {
    setActionError('')
    try {
      await updateAdminReport(reportId, status)
      setReports((current) => current.filter((report) => report.id !== reportId))
      setSelectedAccount((current) => current
        ? { ...current, reports: current.reports.filter((report) => report.id !== reportId) }
        : current)
    } catch (requestError) {
      setActionError(requestError.message || 'The report could not be updated.')
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setActionError('')
    try {
      await deleteAdminAccount(deleteTarget.id)
      setUsers((current) => current.filter((user) => user.id !== deleteTarget.id))
      setReports((current) => current.filter((report) => report.account.id !== deleteTarget.id))
      setSelectedAccount(null)
      setDeleteTarget(null)
    } catch (requestError) {
      setActionError(requestError.message || 'This account could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="settings-page admin-page">
      <header className="settings-header">
        <span className="settings-eyebrow"><span /> ADMIN PRIVILEGES</span>
        <h1>Admin</h1>
        <p>Review account reports and account details. Admin access does not let you sign in as another person.</p>
      </header>
      {error && <p className="saved-page__error" role="alert">{error}<button className="settings-link-button" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Try again</button></p>}
      {actionError && <p className="saved-page__error" role="alert">{actionError}</p>}
      <div className="admin-page__tabs" role="tablist" aria-label="Admin tools">
        <button type="button" role="tab" aria-selected={section === 'reports'} className={section === 'reports' ? 'is-active' : ''} onClick={() => { setSection('reports'); setSelectedAccount(null) }}><Icon name="notifications" size={16} /> Reports <span>{reports.length}</span></button>
        <button type="button" role="tab" aria-selected={section === 'users'} className={section === 'users' ? 'is-active' : ''} onClick={() => { setSection('users'); setSelectedAccount(null) }}><Icon name="account" size={16} /> All accounts</button>
        <button type="button" className="admin-page__refresh" aria-label="Refresh admin data" onClick={() => setRefreshKey((current) => current + 1)}><Icon name="history" size={16} /></button>
      </div>
      {section === 'users' && <form className="admin-page__search" onSubmit={(event) => { event.preventDefault(); setAppliedQuery(userQuery.trim()); setSelectedAccount(null) }}>
        <label className="visually-hidden" htmlFor="admin-account-search">Search accounts by username</label>
        <input id="admin-account-search" value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search usernames" maxLength={80} />
        <button className="settings-link-button" type="submit"><Icon name="search" size={15} /> Search</button>
      </form>}
      <div className="admin-page__layout">
        <section className="admin-page__list" aria-label={section === 'reports' ? 'Open reports' : 'Accounts'}>
          {loading
            ? <p className="admin-page__empty" role="status">Loading…</p>
            : section === 'reports'
              ? reports.length
                ? reports.map((report) => <article className="admin-list-card" key={report.id}>
                  <button className="admin-list-card__identity" type="button" onClick={() => openAccount(report.account.id)}>
                    <strong>{accountLabel(report.account)}</strong>
                    <span>Reported for {report.reason.replaceAll('_', ' ')} · by @{report.reporter.username}</span>
                    {report.details && <small>{report.details}</small>}
                  </button>
                  <button className="settings-link-button" type="button" onClick={() => closeReport(report.id, 'reviewed')}>Mark reviewed</button>
                </article>)
                : <p className="admin-page__empty">No open reports.</p>
              : users.length
                ? users.map((user) => <article className="admin-list-card" key={user.id}>
                  <button className="admin-list-card__identity" type="button" onClick={() => openAccount(user.id)}>
                    <strong>{accountLabel(user)}{user.isAdmin ? ' · Admin' : ''}</strong>
                    <span>{user.isPrivate ? 'Private' : 'Public'} account</span>
                  </button>
                  {!user.isAdmin && <button className="settings-danger-button" type="button" onClick={() => setDeleteTarget(user)}>Delete</button>}
                </article>)
                : <p className="admin-page__empty">No accounts found.</p>}
          {section === 'users' && nextCursor && <button className="settings-link-button admin-page__load-more" type="button" disabled={loadingMore} onClick={loadMoreUsers}>{loadingMore ? 'Loading…' : 'Load more accounts'}</button>}
        </section>
        {loadingAccountId && <aside className="admin-account-detail" role="status">Loading account profile…</aside>}
        {selectedAccount && <aside className="admin-account-detail" aria-label={`Account details for ${selectedAccount.username}`}>
          <div className="admin-account-detail__heading">
            <div><span className="settings-eyebrow">READ-ONLY ACCOUNT REVIEW</span><h2>{selectedAccount.name}</h2><p>@{selectedAccount.username} · not signed in as this user</p></div>
            <button className="icon-button" type="button" aria-label="Close account details" onClick={() => setSelectedAccount(null)}><Icon name="close" size={16} /></button>
          </div>
          <dl><div><dt>Account created</dt><dd>{new Date(selectedAccount.createdAt).toLocaleDateString()}</dd></div><div><dt>Visibility</dt><dd>{selectedAccount.isPrivate ? 'Private' : 'Public'}</dd></div><div><dt>Posts</dt><dd>{selectedAccount.postCount}</dd></div></dl>
          <p className="admin-account-detail__bio">{selectedAccount.bio || 'No profile bio.'}</p>
          {selectedAccount.reports.length > 0 && <section className="admin-account-detail__reports"><h3>Open reports</h3>{selectedAccount.reports.map((report) => <div key={report.id}><strong>{report.reason.replaceAll('_', ' ')}</strong><span>{report.details || 'No extra details.'}</span><small>Reported by @{report.reporter.username}</small><button className="settings-link-button" type="button" onClick={() => closeReport(report.id, 'reviewed')}>Mark reviewed</button></div>)}</section>}
          <section className="admin-account-detail__posts"><h3>Recent posts ({selectedAccount.posts.length})</h3>{selectedAccount.posts.length
            ? selectedAccount.posts.map((post) => <article key={post.id}>{post.media[0] && <img src={post.media[0].url} alt="" loading="lazy" />}<p>{post.caption || 'Media post'}</p><small>{new Date(post.createdAt).toLocaleDateString()} · {post.likes} likes · {post.comments} comments</small></article>)
            : <p>No posts available to review.</p>}</section>
          {!selectedAccount.isAdmin && <button className="settings-danger-button admin-account-detail__delete" type="button" onClick={() => setDeleteTarget(selectedAccount)}>Delete account</button>}
        </aside>}
      </div>
      {deleteTarget && <div className="settings-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !deleting && setDeleteTarget(null)}>
        <section className="settings-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-delete-title">
          <h2 id="admin-delete-title">Delete @{deleteTarget.username}?</h2>
          <p>This permanently deletes the account, its posts, and related data. This action cannot be undone. The deletion is recorded in the admin audit log.</p>
          <div><button type="button" className="settings-secondary-button" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="settings-danger-button" disabled={deleting} onClick={confirmDelete}>{deleting ? 'Deleting…' : 'Delete account'}</button></div>
        </section>
      </div>}
    </div>
  )
}
