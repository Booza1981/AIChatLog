// Sync State Manager
// Centralized state management for tracking sync progress across services

const SYNC_STATE_KEY = 'gemini_sync_state';

/**
 * Get current sync state from storage
 * @returns {Promise<Object>} Sync state object
 */
async function getSyncState() {
  try {
    const result = await chrome.storage.local.get(SYNC_STATE_KEY);
    return result[SYNC_STATE_KEY] || {
      lastFullSync: null,
      lastQuickSync: null,
      lastKnownConversationId: null,
      quickSyncDepth: 50 // default depth
    };
  } catch (error) {
    console.error('[Sync State] Failed to get sync state:', error);
    return {
      lastFullSync: null,
      lastQuickSync: null,
      lastKnownConversationId: null,
      quickSyncDepth: 50
    };
  }
}

/**
 * Update sync state in storage
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated sync state
 */
async function updateSyncState(updates) {
  try {
    const currentState = await getSyncState();
    const newState = { ...currentState, ...updates };
    await chrome.storage.local.set({ [SYNC_STATE_KEY]: newState });
    console.log('[Sync State] State updated:', updates);
    return newState;
  } catch (error) {
    console.error('[Sync State] Failed to update sync state:', error);
    return currentState;
  }
}

/**
 * Set the last synced conversation ID
 * @param {string} conversationId - The most recent conversation ID synced
 * @param {string} type - Type of sync: 'quick' or 'full'
 * @returns {Promise<Object>} Updated sync state
 */
async function setLastSyncedConversation(conversationId, type = 'quick') {
  const updates = {
    lastKnownConversationId: conversationId
  };

  if (type === 'quick') {
    updates.lastQuickSync = Date.now();
  } else if (type === 'full') {
    updates.lastFullSync = Date.now();
  }

  return updateSyncState(updates);
}

/**
 * Get the configured quick sync depth
 * @returns {Promise<number>} Number of conversations to check during quick sync
 */
async function getQuickSyncDepth() {
  const state = await getSyncState();
  return state.quickSyncDepth || 50;
}

/**
 * Set the quick sync depth
 * @param {number} depth - Number of conversations to check during quick sync
 * @returns {Promise<Object>} Updated sync state
 */
async function setQuickSyncDepth(depth) {
  if (typeof depth !== 'number' || depth < 1) {
    console.error('[Sync State] Invalid quick sync depth:', depth);
    return getSyncState();
  }
  return updateSyncState({ quickSyncDepth: depth });
}

/**
 * Get last sync timestamp
 * @param {string} type - Type of sync: 'quick' or 'full'
 * @returns {Promise<number|null>} Timestamp of last sync, or null if never synced
 */
async function getLastSyncTime(type = 'quick') {
  const state = await getSyncState();
  return type === 'quick' ? state.lastQuickSync : state.lastFullSync;
}

/**
 * Reset sync state (useful for debugging or after major changes)
 * @returns {Promise<void>}
 */
async function resetSyncState() {
  try {
    await chrome.storage.local.remove(SYNC_STATE_KEY);
    console.log('[Sync State] State reset');
  } catch (error) {
    console.error('[Sync State] Failed to reset sync state:', error);
  }
}

/**
 * Get sync state summary for display
 * @returns {Promise<Object>} Human-readable summary
 */
async function getSyncStateSummary() {
  const state = await getSyncState();

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

console.log('[Sync State] Manager loaded');
