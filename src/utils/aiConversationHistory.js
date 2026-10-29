function historyKey(userId) {
  return `sonrisetalk-ai-history-${userId}`
}

export function readAIConversations(userId) {
  try {
    const saved = window.localStorage.getItem(historyKey(userId))
    const parsed = saved ? JSON.parse(saved) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((conversation) => (
        conversation
        && typeof conversation.id === 'string'
        && typeof conversation.title === 'string'
        && Array.isArray(conversation.messages)
      ))
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        updated: typeof conversation.updated === 'string' ? conversation.updated : '',
        messages: conversation.messages
          .filter((message) => (
            message
            && typeof message.id === 'string'
            && ['user', 'assistant'].includes(message.role)
            && typeof message.text === 'string'
          ))
          .map((message) => ({
            id: message.id,
            role: message.role,
            text: message.text,
            ...(typeof message.notice === 'string' ? { notice: message.notice } : {}),
            attachments: Array.isArray(message.attachments)
              ? message.attachments
                .filter((attachment) => attachment && typeof attachment.id === 'string' && typeof attachment.name === 'string')
                .map(({ id, name }) => ({ id, name }))
              : [],
          })),
      }))
  } catch (error) {
    console.error('Could not read Trex AI conversation history.', error)
    return []
  }
}

export function saveAIConversations(userId, conversations) {
  try {
    const serializableConversations = conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map(({ id, role, text, notice, attachments = [] }) => ({
        id,
        role,
        text,
        ...(notice ? { notice } : {}),
        attachments: attachments.map(({ id: attachmentId, name }) => ({ id: attachmentId, name })),
      })),
    }))
    window.localStorage.setItem(historyKey(userId), JSON.stringify(serializableConversations))
  } catch (error) {
    console.error('Could not save Trex AI conversation history.', error)
  }
}
