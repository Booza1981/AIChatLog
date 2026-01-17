// ChatGPT Sync State Manager
// Centralized state management for tracking ChatGPT sync progress

const CHATGPT_SYNC_STATE_KEY = 'chatgpt_sync_state';

/**
 * Get current ChatGPT sync state from storage
 * @returns {Promise<Object>} Sync state object
 */
async function getChatGPTSyncState() {
  try {
    const result = await chrome.storage.local.get(CHATGPT_SYNC_STATE_KEY);
    return result[CHATGPT_SYNC_STATE_KEY] || {
      lastFullSync: null,
      lastQuickSync: null,
      lastKnownConversationId: null,
      quickSyncDepth: 50 // default depth
    };
  } catch (error) {
    console.error('[ChatGPT Sync State] Failed to get sync state:', error);
    return {
      lastFullSync: null,
      lastQuickSync: null,
      lastKnownConversationId: null,
      quickSyncDepth: 50
    };
  }
}

/**
 * Update ChatGPT sync state in storage
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated sync state
 */
async function updateChatGPTSyncState(updates) {
  try {
    const currentState = await getChatGPTSyncState();
    const newState = { ...currentState, ...updates };
    await chrome.storage.local.set({ [CHATGPT_SYNC_STATE_KEY]: newState });
    console.log('[ChatGPT Sync State] State updated:', updates);
    return newState;
  } catch (error) {
    console.error('[ChatGPT Sync State] Failed to update sync state:', error);
    return await getChatGPTSyncState();
  }
}

/**
 * Set the last synced conversation ID for ChatGPT
 * @param {string} conversationId - The most recent conversation ID synced
 * @param {string} type - Type of sync: 'quick' or 'full'
 * @returns {Promise<Object>} Updated sync state
 */
async function setChatGPTLastSyncedConversation(conversationId, type = 'quick') {
  const updates = {
    lastKnownConversationId: conversationId
  };

  if (type === 'quick') {
    updates.lastQuickSync = Date.now();
  } else if (type === 'full') {
    updates.lastFullSync = Date.now();
  }

  return updateChatGPTSyncState(updates);
}

/**
 * Get the configured quick sync depth for ChatGPT
 * @returns {Promise<number>} Number of conversations to check during quick sync
 */
async function getChatGPTQuickSyncDepth() {
  const state = await getChatGPTSyncState();
  return state.quickSyncDepth || 50;
}

/**
 * Set the quick sync depth for ChatGPT
 * @param {number} depth - Number of conversations to check during quick sync
 * @returns {Promise<Object>} Updated sync state
 */
async function setChatGPTQuickSyncDepth(depth) {
  if (typeof depth !== 'number' || depth < 1) {
    console.error('[ChatGPT Sync State] Invalid quick sync depth:', depth);
    return getChatGPTSyncState();
  }
  return updateChatGPTSyncState({ quickSyncDepth: depth });
}

/**
 * Get last ChatGPT sync timestamp
 * @param {string} type - Type of sync: 'quick' or 'full'
 * @returns {Promise<number|null>} Timestamp of last sync, or null if never synced
 */
async function getChatGPTLastSyncTime(type = 'quick') {
  const state = await getChatGPTSyncState();
  return type === 'quick' ? state.lastQuickSync : state.lastFullSync;
}

/**
 * Reset ChatGPT sync state (useful for debugging or after major changes)
 * @returns {Promise<void>}
 */
async function resetChatGPTSyncState() {
  try {
    await chrome.storage.local.remove(CHATGPT_SYNC_STATE_KEY);
    console.log('[ChatGPT Sync State] State reset');
  } catch (error) {
    console.error('[ChatGPT Sync State] Failed to reset sync state:', error);
  }
}

/**
 * Get ChatGPT sync state summary for display
 * @returns {Promise<Object>} Human-readable summary
 */
async function getChatGPTSyncStateSummary() {
  const state = await getChatGPTSyncState();

  const formatTime = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.round(diff / 60000) + ' minutes ago';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' hours ago';
    return Math.round(diff / 86400000) + ' days ago';
  };

  return {
    lastFullSync: formatTime(state.lastFullSync),
    lastQuickSync: formatTime(state.lastQuickSync),
    lastKnownConversationId: state.lastKnownConversationId || 'None',
    quickSyncDepth: state.quickSyncDepth || 50
  };
}

console.log('[ChatGPT Sync State] Manager loaded');
