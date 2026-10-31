import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import UserAvatar from '../UserAvatar.jsx'

export default function GroupCallInvitation({ invitation, onJoin, onDecline, onLoadMembers }) {
  const [members, setMembers] = useState(invitation.participants ?? [])
  const [groupMemberCount, setGroupMemberCount] = useState(invitation.groupMemberCount ?? 0)
  const [showMembers, setShowMembers] = useState(false)
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setMembers(invitation.participants ?? [])
    setGroupMemberCount(invitation.groupMemberCount ?? 0)
    setShowMembers(false)
    setLoadingMembers(false)
    setWorking(false)
    setError('')
  }, [invitation.id, invitation.participants, invitation.groupMemberCount])

  async function toggleMembers() {
    if (showMembers) {
      setShowMembers(false)
      return
    }
    setShowMembers(true)
    setLoadingMembers(true)
    setError('')
    try {
      const details = await onLoadMembers(invitation.id)
      setMembers(details.participants)
      setGroupMemberCount(details.groupMemberCount)
    } catch (loadError) {
      setError(loadError.message || 'The people currently in this call could not be loaded.')
    } finally {
      setLoadingMembers(false)
    }
  }

  async function respond(action) {
    setWorking(true)
    setError('')
    try {
      const result = await action(invitation)
      if (result === false) {
        setWorking(false)
        setError('The call could not be joined. Try again or decline the invitation.')
      }
    } catch (actionError) {
      setError(actionError.message || 'The call invitation could not be updated.')
      setWorking(false)
    }
  }

  const caller = invitation.caller ?? {}
  const memberCountLabel = groupMemberCount
    ? `${groupMemberCount} ${groupMemberCount === 1 ? 'person' : 'people'} in the group`
    : 'Group conversation'

  return (
    <div className="messages-group-invitation-backdrop">
      <section className="messages-group-invitation" role="dialog" aria-modal="true" aria-labelledby="group-call-invitation-title">
        <div className="messages-group-invitation__eyebrow"><Icon name="phone" size={15} /> GROUP CALL INVITATION</div>
        <div className="messages-group-invitation__avatar">
          <UserAvatar person={caller} className="messages-group-invitation__photo" alt="" />
          <span aria-hidden="true"><Icon name={invitation.mediaType === 'video' ? 'video' : 'phone'} size={17} /></span>
        </div>
        <h2 id="group-call-invitation-title">{caller.name || caller.username || 'Someone'} is inviting you</h2>
        <p className="messages-group-invitation__conversation">
          to join <strong>{invitation.groupName || 'a group conversation'}</strong>
        </p>
        <p className="messages-group-invitation__count">
          {members.length} {members.length === 1 ? 'person is' : 'people are'} in the call · {memberCountLabel}
        </p>
        <button className="messages-group-invitation__members-toggle" type="button" onClick={toggleMembers} aria-expanded={showMembers}>
          {showMembers ? 'Hide people in call' : 'See people in call'}
          <Icon name="chevron" size={15} />
        </button>
        {showMembers && (
          <div className="messages-group-invitation__members" aria-live="polite">
            {loadingMembers && <p>Loading people in the call…</p>}
            {!loadingMembers && !members.length && <p>No one is in the call right now.</p>}
            {!loadingMembers && members.map((member) => (
              <div className="messages-group-invitation__member" key={member.userId}>
                <UserAvatar person={member} className="messages-group-invitation__member-photo" alt="" />
                <span>{member.name}</span>
              </div>
            ))}
          </div>
        )}
        {error && <p className="messages-group-invitation__error" role="alert">{error}</p>}
        <div className="messages-group-invitation__actions">
          <button type="button" className="messages-group-invitation__decline" disabled={working} onClick={() => respond(onDecline)}>Decline</button>
          <button type="button" className="messages-group-invitation__join" disabled={working} onClick={() => respond(onJoin)}>
            <Icon name="phone" size={16} /> {working ? 'Joining…' : 'Join conversation'}
          </button>
        </div>
      </section>
    </div>
  )
}
