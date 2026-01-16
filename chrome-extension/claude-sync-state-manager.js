// Claude Sync State Manager
// Centralized state management for tracking Claude sync progress

const CLAUDE_SYNC_STATE_KEY = 'claude_sync_state';

/**
 * Get current Claude sync state from storage
 * @returns {Promise<Object>} Sync state object
 */
async function getClaudeSyncState() {
  try {
    const result = await chrome.storage.local.get(CLAUDE_SYNC_STATE_KEY);
    return result[CLAUDE_SYNC_STATE_KEY] || {
      lastFullSync: null,
      lastQuickSync: null,
      lastKnownConversationId: null,
      quickSyncDepth: 50 // default depth
    };
  } catch (error) {
    console.error('[Claude Sync State] Failed to get sync state:', error);
    return {
      lastFullSync: null,
      lastQuickSync: null,
      lastKnownConversationId: null,
      quickSyncDepth: 50
    };
  }
}

/**
 * Update Claude sync state in storage
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated sync state
 */
async function updateClaudeSyncState(updates) {
  try {
    const currentState = await getClaudeSyncState();
    const newState = { ...currentState, ...updates };
    await chrome.storage.local.set({ [CLAUDE_SYNC_STATE_KEY]: newState });
    console.log('[Claude Sync State] State updated:', updates);
    return newState;
  } catch (error) {
    console.error('[Claude Sync State] Failed to update sync state:', error);
    return await getClaudeSyncState();
  }
}

/**
 * Set the last synced conversation ID for Claude
 * @param {string} conversationId - The most recent conversation ID synced
 * @param {string} type - Type of sync: 'quick' or 'full'
 * @returns {Promise<Object>} Updated sync state
 */
async function setClaudeLastSyncedConversation(conversationId, type = 'quick') {
  const updates = {
    lastKnownConversationId: conversationId
  };

  if (type === 'quick') {
    updates.lastQuickSync = Date.now();
  } else if (type === 'full') {
    updates.lastFullSync = Date.now();
  }

  return updateClaudeSyncState(updates);
}

/**
 * Get the configured quick sync depth for Claude
 * @returns {Promise<number>} Number of conversations to check during quick sync
 */
async function getClaudeQuickSyncDepth() {
  const state = await getClaudeSyncState();
  return state.quickSyncDepth || 50;
}

/**
 * Set the quick sync depth for Claude
 * @param {number} depth - Number of conversations to check during quick sync
 * @returns {Promise<Object>} Updated sync state
 */
async function setClaudeQuickSyncDepth(depth) {
  if (typeof depth !== 'number' || depth < 1) {
    console.error('[Claude Sync State] Invalid quick sync depth:', depth);
    return getClaudeSyncState();
  }
  return updateClaudeSyncState({ quickSyncDepth: depth });
}

/**
 * Get last Claude sync timestamp
 * @param {string} type - Type of sync: 'quick' or 'full'
 * @returns {Promise<number|null>} Timestamp of last sync, or null if never synced
 */
async function getClaudeLastSyncTime(type = 'quick') {
  const state = await getClaudeSyncState();
  return type === 'quick' ? state.lastQuickSync : state.lastFullSync;
}

/**
 * Reset Claude sync state (useful for debugging or after major changes)
 * @returns {Promise<void>}
 */
async function resetClaudeSyncState() {
  try {
    await chrome.storage.local.remove(CLAUDE_SYNC_STATE_KEY);
    console.log('[Claude Sync State] State reset');
  } catch (error) {
    console.error('[Claude Sync State] Failed to reset sync state:', error);
  }
}

/**
 * Get Claude sync state summary for display
 * @returns {Promise<Object>} Human-readable summary
 */
async function getClaudeSyncStateSummary() {
  const state = await getClaudeSyncState();

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

console.log('[Claude Sync State] Manager loaded');
