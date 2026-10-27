import { useEffect, useRef, useState } from 'react'
import { getSonriseAIStatus, sendSonriseAIMessage } from '../../api/sonriseAi.js'
import BrandMark from '../BrandMark.jsx'
import Icon from '../Icon.jsx'

const MAX_AI_FILES = 4
const MAX_AI_FILE_BYTES = 3 * 1024 * 1024
const allowedFileTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
])

function AttachmentImage({ file, name, className }) {
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => {
    if (!file?.type.startsWith('image/')) return undefined
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return previewUrl ? <img className={className} src={previewUrl} alt={name} /> : null
}

function AIMessage({ message, onManagePermissions }) {
  return (
    <article className={`sonrise-ai-message sonrise-ai-message--${message.role}`}>
      {message.role === 'assistant' && <span className="sonrise-ai-message__mark"><BrandMark size={17} /></span>}
      <div className="sonrise-ai-message__body">
        <span className="sonrise-ai-message__author">{message.role === 'assistant' ? 'SONRISE AI' : 'You'}</span>
        {message.text && <p>{message.text}</p>}
        {message.attachments?.length > 0 && <div className="sonrise-ai-message__attachments">
          {message.attachments.map((attachment) => attachment.file?.type.startsWith('image/')
            ? <AttachmentImage className="sonrise-ai-message__image" key={attachment.id} file={attachment.file} name={attachment.name} />
            : <span key={attachment.id}><Icon name="attachment" size={13} /> {attachment.name}</span>)}
        </div>}
        {message.notice && <><p className="sonrise-ai-message__notice">{message.notice}</p><button className="sonrise-ai-manage-link" type="button" onClick={onManagePermissions}>Manage permissions <Icon name="arrow" size={13} /></button></>}
      </div>
    </article>
  )
}

function ConversationMenu({ onRename, onClear, onDelete }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="sonrise-ai-conversation-menu">
      <button className="sonrise-ai-icon-button" type="button" aria-label="Conversation options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><Icon name="more" size={19} /></button>
      {open && <div className="sonrise-ai-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onRename() }}>Rename</button>
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onClear() }}>Clear conversation</button>
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onDelete() }}>Delete conversation</button>
      </div>}
    </div>
  )
}

export default function SonriseAIPage({ conversations, setConversations, activeConversationId, setActiveConversationId, onManagePermissions, onBack }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState([])
  const [providerStatus, setProviderStatus] = useState('loading')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)
  const fileInputRef = useRef(null)
  const currentConversation = conversations.find(({ id }) => id === activeConversationId)
  const messages = currentConversation?.messages ?? []
  const canChat = providerStatus === 'available' && !sending

  function addFiles(fileList) {
    const files = Array.from(fileList)
    if (!files.length) return
    const existingBytes = attachments.reduce((total, item) => total + item.file.size, 0)
    const remainingSlots = MAX_AI_FILES - attachments.length
    if (files.length > remainingSlots) {
      setError(`You can attach up to ${MAX_AI_FILES} files per message.`)
      return
    }
    const invalidFile = files.find((file) => !allowedFileTypes.has(file.type) || file.size > MAX_AI_FILE_BYTES)
    if (invalidFile) {
      setError(`${invalidFile.size > MAX_AI_FILE_BYTES
        ? 'Each file must be 3 MB or smaller.'
        : 'Choose images, PDFs, or text files (TXT, MD, CSV).'}`)
      return
    }
    const addedBytes = files.reduce((total, file) => total + file.size, 0)
    if (existingBytes + addedBytes > MAX_AI_FILES * MAX_AI_FILE_BYTES) {
      setError('Together, uploaded files must be 12 MB or smaller.')
      return
    }
    setError('')
    const selectedFiles = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
    }))
    setAttachments((current) => [...current, ...selectedFiles])
  }

  function removeAttachment(id) {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }

  useEffect(() => {
    const controller = new AbortController()
    getSonriseAIStatus({ signal: controller.signal })
      .then(({ configured }) => setProviderStatus(configured ? 'available' : 'unavailable'))
      .catch((statusError) => {
        if (statusError.name !== 'AbortError') {
          setProviderStatus('error')
          setError(statusError.message || 'AI availability could not be checked.')
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [messages.length, sending])

  useEffect(() => {
    if (!renameOpen) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') setRenameOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [renameOpen])

  function startNewChat() {
    setActiveConversationId(null)
    setHistoryOpen(false)
  }

  function selectConversation(id) {
    setActiveConversationId(id)
    setHistoryOpen(false)
  }

  function clearConversation() {
    if (!currentConversation) return
    setConversations((current) => current.map((item) => item.id === activeConversationId ? { ...item, messages: [] } : item))
  }

  function deleteConversation() {
    setConversations((current) => current.filter((item) => item.id !== activeConversationId))
    setActiveConversationId(null)
  }

  function openRename() {
    if (!currentConversation) return
    setRenameValue(currentConversation.title)
    setRenameOpen(true)
  }

  function saveRename(event) {
    event.preventDefault()
    const title = renameValue.trim()
    if (!title || !activeConversationId) return
    setConversations((current) => current.map((item) => item.id === activeConversationId ? { ...item, title } : item))
    setRenameOpen(false)
  }

  async function submitPrompt(event) {
    event.preventDefault()
    const text = prompt.trim()
    if ((!text && !attachments.length) || !canChat) return

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      attachments: attachments.map(({ id, name, file }) => ({ id, name, file })),
    }
    const targetConversationId = activeConversationId || crypto.randomUUID()
    const updated = new Date().toLocaleString()
    const priorMessages = currentConversation?.messages ?? []
    const nextMessages = [...priorMessages, userMessage]
    const history = nextMessages.slice(-12)
    const files = history.flatMap((message, messageIndex) => (
      message.attachments?.map(({ file }) => ({ file, messageIndex })) ?? []
    )).filter(({ file }) => file instanceof Blob).slice(-MAX_AI_FILES)

    setError('')
    setPrompt('')
    setAttachments([])
    setSending(true)
    if (!currentConversation) {
      setConversations((current) => [{
        id: targetConversationId,
        title: (text || attachments.map(({ name }) => name).join(', ')).slice(0, 48),
        updated,
        messages: nextMessages,
      }, ...current])
      setActiveConversationId(targetConversationId)
    } else {
      setConversations((current) => current.map((item) => item.id === targetConversationId
        ? { ...item, updated, messages: nextMessages }
        : item))
    }

    try {
      const { text: answer } = await sendSonriseAIMessage(
        history.map(({ role, text: messageText }) => ({ role, text: messageText })),
        files,
      )
      const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', text: answer }
      setConversations((current) => current.map((item) => item.id === targetConversationId
        ? { ...item, messages: [...item.messages, assistantMessage] }
        : item))
    } catch (sendError) {
      setError(sendError.message || 'The AI service could not complete this request.')
    } finally {
      setSending(false)
    }
  }

  const accessLabel = providerStatus === 'loading'
    ? 'Checking availability…'
    : providerStatus === 'available'
      ? 'AI ready'
      : providerStatus === 'error'
        ? 'AI unavailable'
        : 'AI not configured'
  const welcomeMessage = providerStatus === 'loading'
    ? 'Checking AI availability…'
    : providerStatus === 'available'
      ? 'Ask SONRISE AI anything.'
      : providerStatus === 'error'
        ? 'The AI service could not be reached.'
        : 'SONRISE AI needs a Gemini API key.'

  return (
    <div className="sonrise-ai-page">
      <header className="sonrise-ai-page__header">
        <div className="sonrise-ai-page__title">
          <span className="sonrise-ai-page__eyebrow"><i /> YOUR ASSISTANT</span>
          <h1>SONRISE AI</h1>
          <p>{providerStatus === 'available' ? 'A little light when you need it.' : 'AI responses need a configured provider.'}</p>
        </div>
        <div className="sonrise-ai-page__header-actions">
          <span className="sonrise-ai-access"><i />{accessLabel}</span>
          <button className="sonrise-ai-header-button sonrise-ai-manage-desktop" type="button" onClick={onManagePermissions}>Manage permissions</button>
          <button className="sonrise-ai-header-button sonrise-ai-history-toggle" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((current) => !current)}><Icon name="history" size={17} /> History</button>
          <button className="sonrise-ai-back-button" type="button" aria-label="Go back" title="Go back" onClick={onBack}><Icon name="back" size={19} /></button>
        </div>
      </header>

      <div className="sonrise-ai-layout">
        <aside className={`sonrise-ai-history${historyOpen ? ' is-open' : ''}`} aria-label="Conversation history">
          <div className="sonrise-ai-history__heading">
            <h2>Recent</h2>
            <button className="sonrise-ai-icon-button" type="button" aria-label="Close conversation history" onClick={() => setHistoryOpen(false)}><Icon name="close" size={17} /></button>
          </div>
          <button className="sonrise-ai-new-chat" type="button" onClick={startNewChat}><Icon name="add" size={16} /> New chat</button>
          <div className="sonrise-ai-history__list">
            {conversations.map((conversation) => <button className={`sonrise-ai-history-item${conversation.id === activeConversationId ? ' is-active' : ''}`} type="button" key={conversation.id} onClick={() => selectConversation(conversation.id)}>
              <span><strong>{conversation.title}</strong><small>{conversation.updated}</small></span>
              <Icon name="chevron" size={15} />
            </button>)}
            {conversations.length === 0 && <p className="sonrise-ai-history__empty">Your conversations will appear here.</p>}
          </div>
        </aside>

        {historyOpen && <button className="sonrise-ai-history-backdrop" type="button" aria-label="Close conversation history" onClick={() => setHistoryOpen(false)} />}

        <section className="sonrise-ai-chat" aria-label="SONRISE AI conversation">
          <div className="sonrise-ai-chat__topline">
            <span className="sonrise-ai-ready"><i /> {providerStatus === 'available' ? 'Ready' : accessLabel}</span>
            {currentConversation && <ConversationMenu onRename={openRename} onClear={clearConversation} onDelete={deleteConversation} />}
          </div>
          <div className={`sonrise-ai-chat__conversation${messages.length ? ' has-messages' : ''}`}>
            {messages.length === 0 ? (
              <div className="sonrise-ai-welcome">
                <span className="sonrise-ai-welcome__mark"><BrandMark size={35} /></span>
                <span className="sonrise-ai-page__eyebrow"><i /> SONRISE AI</span>
                <h2>{welcomeMessage}</h2>
                <p>{providerStatus === 'available'
                  ? 'Your messages are sent securely through the server.'
                  : providerStatus === 'loading'
                    ? 'Please wait while the server checks AI availability.'
                    : providerStatus === 'error'
                      ? error || 'Check the Render Web Service logs and confirm its API is running.'
                      : 'Add GEMINI_API_KEY in Render → your Web Service → Environment, then redeploy.'}</p>
              </div>
            ) : (
              <div className="sonrise-ai-messages">
                {messages.map((message) => <AIMessage key={message.id} message={message} onManagePermissions={onManagePermissions} />)}
                <div ref={endRef} />
              </div>
            )}
          </div>
          <form className="sonrise-ai-composer" onSubmit={submitPrompt}>
            <label className="visually-hidden" htmlFor="sonrise-ai-prompt">Ask SONRISE AI</label>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain,text/markdown,text/csv,.pdf,.txt,.md,.csv"
              multiple
              onChange={(event) => {
                addFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <button className="sonrise-ai-attach" type="button" aria-label="Attach images or files" title="Attach images or files" disabled={!canChat} onClick={() => fileInputRef.current?.click()}>
              <Icon name="attachment" size={17} />
            </button>
            <textarea id="sonrise-ai-prompt" rows="1" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={!canChat} maxLength={6000} placeholder={providerStatus === 'available' ? 'Write a message…' : 'AI is unavailable'} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form.requestSubmit()
              }
            }} />
            {attachments.length > 0 && <div className="sonrise-ai-composer__attachments">
              {attachments.map((attachment) => <span className="sonrise-ai-composer__attachment" key={attachment.id}>
                {attachment.file.type.startsWith('image/') && <AttachmentImage className="sonrise-ai-composer__attachment-image" file={attachment.file} name="" />}
                <span>{attachment.name}</span>
                <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment.id)}><Icon name="close" size={13} /></button>
              </span>)}
            </div>}
            <span className="sonrise-ai-composer__hint" role={error ? 'alert' : undefined}>{error || (sending ? 'SONRISE AI is thinking…' : canChat ? 'Enter to send · Shift+Enter for a new line' : providerStatus === 'unavailable' ? 'Add GEMINI_API_KEY in Render → your Web Service → Environment, then redeploy.' : 'Responses are unavailable until AI is configured.')}</span>
            <button className="sonrise-ai-send" type="submit" aria-label="Send to SONRISE AI" disabled={!canChat || (!prompt.trim() && !attachments.length)}><Icon name="send" size={17} /></button>
          </form>
        </section>
      </div>

      {renameOpen && <div className="sonrise-ai-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setRenameOpen(false)}>
        <form className="sonrise-ai-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="sonrise-ai-rename-title" onSubmit={saveRename}>
          <h2 id="sonrise-ai-rename-title">Rename conversation</h2>
          <label htmlFor="sonrise-ai-rename-input">Conversation name</label>
          <input id="sonrise-ai-rename-input" value={renameValue} maxLength={48} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
          <div><button type="button" onClick={() => setRenameOpen(false)}>Cancel</button><button type="submit" disabled={!renameValue.trim()}>Save</button></div>
        </form>
      </div>}
    </div>
  )
}
