import { useState } from 'react'
import BrandMark from '../BrandMark.jsx'
import GlassSurface from '../GlassSurface.jsx'
import Icon from '../Icon.jsx'
import ProfilePhotoButton from '../ProfilePhotoButton.jsx'
import UserAvatar from '../UserAvatar.jsx'

export function StoriesPanel({ onAddStory, onOpenStory, stories = [], ownStory, currentUser }) {
  const openYourStory = ownStory ? () => onOpenStory(ownStory.id) : onAddStory
  return (
    <section className="stories-panel" aria-labelledby="stories-title">
      <h2 id="stories-title" className="visually-hidden">Stories</h2>
      <div className="stories-list">
        <div className="story-item story-item--add">
          <div className="story-item__add-wrapper">
            <button className="profile-photo-button" type="button" aria-label={ownStory ? 'View your story' : 'Add to your story'} onClick={openYourStory}><UserAvatar person={currentUser} className="story-avatar" /></button>
            <button className="story-add-badge" type="button" aria-label="Add to your story" onClick={onAddStory}><Icon name="add" size={12} /></button>
          </div>
          <button className="story-item__name story-item__open" type="button" onClick={openYourStory}>{currentUser?.id ? 'Your story' : 'Guest story'}</button>
        </div>
        {stories.map((storyGroup) => <div className={`story-item${storyGroup.viewed ? ' is-viewed' : ''}`} key={storyGroup.profileId}>
          <button className="profile-photo-button" type="button" aria-label={`View ${storyGroup.name}'s story`} onClick={() => onOpenStory(storyGroup.firstStoryId)}>
            <UserAvatar person={storyGroup} className="story-avatar" />
          </button>
          <button className="story-item__name story-item__open" type="button" onClick={() => onOpenStory(storyGroup.firstStoryId)}>{storyGroup.name}</button>
        </div>)}</div>
    </section>
  )
}

export function SuggestedPeople({ people = [], onViewProfile, followedProfileIds = [], followRequestsSentIds = [], onToggleFollow }) {
  return (
    <section className="suggested-people" aria-labelledby="suggested-people-title">
      <div className="suggested-people__header">
        <h2 id="suggested-people-title">Suggestions For You</h2>
        <button className="text-action-link" type="button">See All</button>
      </div>
      <div className="suggested-list">{people.map((person) => {
        const isFollowing = followedProfileIds.includes(person.id)
        const requestSent = followRequestsSentIds.includes(person.id)
        return <div className="suggested-person" key={person.id}>
        <button className="suggested-person__identity" type="button" aria-label={`View ${person.name}'s profile`} onClick={() => onViewProfile(person.id)}>
          <UserAvatar person={person} />
          <span className="suggested-person__copy"><strong>{person.handle}</strong><small>Suggested for you</small></span>
        </button>
        <button type="button" className={`follow-btn ${isFollowing || requestSent ? 'is-following' : ''}`} aria-pressed={isFollowing || requestSent} onClick={() => onToggleFollow(person)}>{isFollowing ? 'Following' : requestSent ? 'Request sent' : 'Follow'}</button>
      </div>})}</div>
      {!people.length && <p className="suggested-empty">More people will appear as they join.</p>}
    </section>
  )
}

export function CurrentUserProfile({ user, onSwitchAccount, onViewProfile }) {
  if (!user?.id) {
    return (
      <div className="current-user-profile" aria-label="Guest preview">
        <span className="avatar avatar--amber" aria-hidden="true">G</span>
        <div className="current-user-profile__copy">
          <strong>Guest preview</strong>
          <small>No account signed in</small>
        </div>
      </div>
    )
  }

  return (
    <div className="current-user-profile">
      <ProfilePhotoButton person={{ name: user.name, own: true }} onViewProfile={onViewProfile}><UserAvatar person={user} /></ProfilePhotoButton>
      <div className="current-user-profile__copy">
        <strong>{user.username}</strong>
        <small>{user.name}</small>
      </div>
      <button className="text-action-link" type="button" onClick={onSwitchAccount}>Switch</button>
    </div>
  )
}

export function HomeAIShortcut({ onOpen }) {
  return <button className="home-ai-shortcut" type="button" onClick={onOpen}>
    <span className="home-ai-shortcut__mark"><BrandMark size={18} /></span>
    <span className="home-ai-shortcut__copy"><strong>SONRISE AI</strong><small>Open your assistant</small></span>
    <Icon name="arrow" size={15} />
  </button>
}

export function SonriseAIHomeCard({ onOpen }) {
  return (
    <GlassSurface as="section" className="home-ai" aria-labelledby="home-ai-title">
      <div className="home-ai__top"><span className="home-ai__mark"><BrandMark size={22} /></span><span className="home-ai__label">A LITTLE LIGHT, WHEN YOU NEED IT</span><span className="home-ai__live" /></div>
      <h2 id="home-ai-title">SONRISE <span>AI</span></h2>
      <p>Need help finding something in your world?</p>
      <div className="home-ai__actions"><button type="button" onClick={() => onOpen('Explore')}>Explore</button><button type="button" onClick={() => onOpen('Understand')}>Understand</button><button type="button" onClick={() => onOpen('Create')}>Create</button></div>
      <button type="button" className="home-ai__open" onClick={() => onOpen('Hello')}>Open SONRISE AI <Icon name="arrow" size={14} /></button>
    </GlassSurface>
  )
}
