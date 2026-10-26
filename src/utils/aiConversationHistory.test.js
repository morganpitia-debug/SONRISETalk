import assert from 'node:assert/strict'
import test from 'node:test'
import { readAIConversations, saveAIConversations } from './aiConversationHistory.js'

test('AI conversation history persists per account without storing uploaded file data', () => {
  const previousWindow = globalThis.window
  const storage = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  }

  try {
    saveAIConversations('user-one', [{
      id: 'conversation-one',
      title: 'Saved conversation',
      updated: 'Today',
      messages: [{
        id: 'message-one',
        role: 'user',
        text: 'What is in this image?',
        attachments: [{ id: 'file-one', name: 'photo.png', file: { contents: 'not saved' } }],
      }],
    }])

    assert.equal(readAIConversations('user-one')[0].messages[0].attachments[0].name, 'photo.png')
    assert.equal(readAIConversations('user-two').length, 0)
    assert.equal(storage.get('sonrisetalk-ai-history-user-one').includes('not saved'), false)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
