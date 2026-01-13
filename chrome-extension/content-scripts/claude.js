/**
 * Claude.ai Content Script
 * Extracts conversation data from the actual DOM
 */

const SERVICE = 'claude';
const API_BASE = 'http://localhost:8000';

// Safe debug logging function
async function debugLog(message, data = null) {
  try {
    if (typeof window.debugLog === 'function') {
      await window.debugLog(message, data);
    }
  } catch (e) {
    // Silently fail
  }
}

// Check if full sync is running (persists across page reloads)
async function isFullSyncActive() {
  const result = await chrome.storage.local.get(['fullSyncActive']);
  return result.fullSyncActive || false;
}

async function setFullSyncActive(active) {
  await chrome.storage.local.set({ fullSyncActive: active });
}

// Listen for sync requests from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    // Simple ping test to verify content script is loaded
    console.log('[Claude] Ping received');
    sendResponse({ success: true, loaded: true });
    return true;
  }

  if (request.action === 'sync') {
    console.log('[Claude] Sync requested');
    debugLog('Sync requested');
    performSync()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  } else if (request.action === 'syncAll') {
    console.log('[Claude] Sync ALL conversations requested');
    debugLog('Sync ALL conversations requested', { action: 'syncAll' });

    // Start the sync but respond immediately (sync takes too long for message channel)
    performSyncAll()
      .catch(error => {
        console.error('[Claude] Sync all error:', error);
        debugLog('Sync all error', { error: error.message, stack: error.stack });
        showNotification('✗ Full sync failed: ' + error.message, 'error');
      });

    // Respond immediately so popup doesn't timeout
    sendResponse({ success: true, message: 'Sync started - watch for notifications' });
    return true;
  } else if (request.action === 'syncQuick') {
    console.log('[Claude] Quick sync (incremental) requested');
    debugLog('Quick sync requested', { action: 'syncQuick' });

    performSyncQuick()
      .catch(error => {
        console.error('[Claude] Quick sync error:', error);
        debugLog('Quick sync error', { error: error.message, stack: error.stack });
        showNotification('✗ Quick sync failed: ' + error.message, 'error');
      });

    sendResponse({ success: true, message: 'Quick sync started - watch for notifications' });
    return true;
  }
});

// Main sync function
async function performSync() {
  try {
    console.log('[Claude] Starting conversation sync...');
    console.log('[Claude] Current page:', window.location.href);

    // Check if we're on the right page
    if (!isClaudeChatPage()) {
      throw new Error('Not on Claude chat page. Please navigate to claude.ai');
    }

    // Check if backend is reachable
    try {
      const healthCheck = await fetch(`${API_BASE}/api/health`);
      if (!healthCheck.ok) {
        throw new Error(`Backend not healthy (status: ${healthCheck.status}). Make sure Docker is running.`);
      }
      console.log('[Claude] Backend is healthy');
    } catch (e) {
      throw new Error(`Cannot reach backend at ${API_BASE}. Make sure Docker containers are running: docker-compose up -d`);
    }

    // Get all conversations from sidebar
    const conversations = await extractConversations();
    console.log(`[Claude] Found ${conversations.length} conversations`);

    if (conversations.length === 0) {
      const currentPath = window.location.pathname;
      if (!currentPath.startsWith('/chat/')) {
        throw new Error(`You are on ${currentPath}. Please open a specific conversation first (URL should be /chat/something), then try syncing again.`);
      } else {
        throw new Error('Could not extract the current conversation. The page might still be loading, or Claude UI changed. Check console for details.');
      }
    }

    // Send to backend
    const response = await fetch(`${API_BASE}/api/import/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations })
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const result = await response.json();
    console.log('[Claude] Sync complete:', result);

    // Notify background script
    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: result
    });

    // Show success notification
    showNotification('✓ Claude conversations synced', 'success');

  } catch (error) {
    console.error('[Claude] Sync failed:', error);
    chrome.runtime.sendMessage({
      action: 'syncError',
      service: SERVICE,
      error: error.message
    });
    showNotification('✗ Sync failed: ' + error.message, 'error');
    throw error;
  }
}

// Sync ALL conversations using API (much faster!)
async function performSyncAll() {
  try {
    console.log('[Claude] ========== performSyncAll() CALLED (API MODE) ==========');
    debugLog('performSyncAll started - using API');

    // Show notification
    const notification = showNotification('Fetching conversations via API...', 'info');

    // Fetch all conversations via API
    const { orgId, conversations } = await fetchAllConversationsViaAPI();

    console.log(`[Claude] Got ${conversations.length} conversations from API`);
    debugLog('API returned conversations', { count: conversations.length });

    // Update notification
    showNotification(`Syncing ${conversations.length} conversations via API...`, 'info');

    // Create persistent progress notification
    const progressNotification = document.createElement('div');
    progressNotification.id = 'claude-sync-progress';
    progressNotification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #3b82f6;
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      z-index: 10000;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      font-weight: 500;
      min-width: 250px;
    `;
    document.body.appendChild(progressNotification);

    let synced = 0;
    let failed = 0;

    // Sync each conversation via API (no page navigation needed!)
    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];

      progressNotification.textContent = `Syncing ${i + 1}/${conversations.length}: ${conv.name || 'Untitled'}`;
      console.log(`[Claude] Syncing ${i + 1}/${conversations.length}: ${conv.uuid}`);

      try {
        // Fetch full conversation with messages
        const fullConversation = await fetchConversationMessages(orgId, conv.uuid);

        // Convert to our format
        const dbConversation = convertClaudeAPIToDBFormat(fullConversation);

        console.log(`[Claude] Fetched conversation: ${dbConversation.title} (${dbConversation.messages.length} messages)`);

        // Send to backend
        const response = await fetch(`${API_BASE}/api/import/claude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: [dbConversation] })
        });

        if (response.ok) {
          synced++;
          console.log(`[Claude] ✓ Synced: ${dbConversation.title}`);
          debugLog('Conversation synced', { title: dbConversation.title, synced, failed });
        } else {
          failed++;
          console.error(`[Claude] ✗ Failed to save: ${dbConversation.title}`);
          debugLog('Save failed', { title: dbConversation.title, status: response.status });
        }
      } catch (error) {
        failed++;
        console.error(`[Claude] Error syncing ${conv.uuid}:`, error);
        debugLog('Sync error', { uuid: conv.uuid, error: error.message });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Remove progress notification
    progressNotification.remove();

    // Show final result
    showNotification(`✓ Synced ${synced}/${conversations.length} conversations! (${failed} failed)`, 'success');
    console.log(`[Claude] API sync complete: ${synced} synced, ${failed} failed out of ${conversations.length} total`);
    debugLog('API sync COMPLETE', { synced, failed, total: conversations.length });

    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: { synced, failed, total: conversations.length }
    });

  } catch (error) {
    console.error('[Claude] Full sync FAILED with error:', error);
    console.error('[Claude] Error stack:', error.stack);
    alert('SYNC ALL FAILED: ' + error.message + '\n\nCheck console for details.');
    debugLog('Full sync FAILED with exception', { error: error.message, stack: error.stack });

    // Remove progress notification if it exists
    const progressNotification = document.getElementById('claude-sync-progress');
    if (progressNotification) {
      progressNotification.remove();
    }

    showNotification('✗ Full sync failed: ' + error.message, 'error');
    throw error;
  }
}

/**
 * Perform quick incremental sync - only sync new/updated conversations
 * Uses backend check endpoint to determine which conversations need syncing
 */
async function performSyncQuick() {
  try {
    console.log('[Claude] ========== performSyncQuick() CALLED (INCREMENTAL MODE) ==========');
    debugLog('performSyncQuick started - incremental mode');

    // Show notification
    showNotification('Fetching conversations for quick sync...', 'info');

    // Fetch all conversations via API
    const { orgId, conversations } = await fetchAllConversationsViaAPI();

    console.log(`[Claude] Got ${conversations.length} conversations from API for quick sync`);
    debugLog('API returned conversations for quick sync', { count: conversations.length });

    if (conversations.length === 0) {
      showNotification('No conversations found', 'error');
      return;
    }

    // Build check payload with conversation IDs and timestamps
    const checkPayload = conversations.map(conv => ({
      conversation_id: conv.uuid,
      source: 'claude',
      updated_at: conv.updated_at || null
    })).filter(item => item.conversation_id);

    console.log(`[Claude] Checking ${checkPayload.length} conversations with backend...`);
    showNotification(`Checking ${checkPayload.length} conversations...`, 'info');

    // Check with backend which conversations need syncing
    const checkResponse = await fetch(`${API_BASE}/api/conversations/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations: checkPayload })
    });

    if (!checkResponse.ok) {
      throw new Error(`Backend check failed: ${checkResponse.status}`);
    }

    const checkResult = await checkResponse.json();
    const needsSyncIds = new Set(checkResult.needs_sync || []);

    console.log(`[Claude] Backend says ${needsSyncIds.size} conversations need syncing`);
    debugLog('Check result', { total: conversations.length, needsSync: needsSyncIds.size });

    if (needsSyncIds.size === 0) {
      showNotification('✓ All conversations up to date!', 'success');
      chrome.runtime.sendMessage({
        action: 'syncComplete',
        service: SERVICE,
        result: { synced: 0, failed: 0, total: conversations.length }
      });
      return;
    }

    // Filter to only conversations that need syncing
    const conversationsToSync = conversations.filter(conv => needsSyncIds.has(conv.uuid));

    console.log(`[Claude] Will sync ${conversationsToSync.length} conversations`);
    showNotification(`Syncing ${conversationsToSync.length} conversations...`, 'info');

    // Create persistent progress notification
    const progressNotification = document.createElement('div');
    progressNotification.id = 'claude-sync-progress';
    progressNotification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #3b82f6;
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      z-index: 10000;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      font-weight: 500;
      min-width: 250px;
    `;
    document.body.appendChild(progressNotification);

    let synced = 0;
    let failed = 0;

    // Sync each conversation
    for (let i = 0; i < conversationsToSync.length; i++) {
      const conv = conversationsToSync[i];

      progressNotification.textContent = `Quick sync ${i + 1}/${conversationsToSync.length}: ${conv.name || 'Untitled'}`;
      console.log(`[Claude] Syncing ${i + 1}/${conversationsToSync.length}: ${conv.uuid}`);

      try {
        // Fetch full conversation with messages
        const fullConversation = await fetchConversationMessages(orgId, conv.uuid);

        // Convert to our format
        const dbConversation = convertClaudeAPIToDBFormat(fullConversation);

        // Send to backend
        const response = await fetch(`${API_BASE}/api/import/claude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: [dbConversation] })
        });

        if (response.ok) {
          synced++;
          console.log(`[Claude] ✓ Synced: ${dbConversation.title}`);
          debugLog('Conversation synced', { title: dbConversation.title, synced, failed });
        } else {
          failed++;
          console.error(`[Claude] ✗ Failed to save: ${dbConversation.title}`);
          debugLog('Save failed', { title: dbConversation.title, status: response.status });
        }
      } catch (error) {
        failed++;
        console.error(`[Claude] Error syncing ${conv.uuid}:`, error);
        debugLog('Sync error', { uuid: conv.uuid, error: error.message });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Remove progress notification
    progressNotification.remove();

    // Show final result
    showNotification(`✓ Quick sync: ${synced}/${conversationsToSync.length} synced! (${failed} failed)`, 'success');
    console.log(`[Claude] Quick sync complete: ${synced} synced, ${failed} failed out of ${conversationsToSync.length} needed`);
    debugLog('Quick sync COMPLETE', { synced, failed, total: conversationsToSync.length });

    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: { synced, failed, total: conversationsToSync.length }
    });

  } catch (error) {
    console.error('[Claude] Quick sync FAILED with error:', error);
    console.error('[Claude] Error stack:', error.stack);
    debugLog('Quick sync FAILED with exception', { error: error.message, stack: error.stack });

    // Remove progress notification if it exists
    const progressNotification = document.getElementById('claude-sync-progress');
    if (progressNotification) {
      progressNotification.remove();
    }

    showNotification('✗ Quick sync failed: ' + error.message, 'error');
    throw error;
  }
}

// Check if we're on a Claude chat page
function isClaudeChatPage() {
  return window.location.hostname.includes('claude.ai');
}

// Extract all conversations
async function extractConversations() {
  const conversations = [];

  // Use ACTUAL Claude selector for sidebar conversations
  const conversationLinks = Array.from(document.querySelectorAll('a[data-dd-action-name="sidebar-chat-item"]'));

  console.log(`[Claude] Found ${conversationLinks.length} conversation links in sidebar`);
  console.log(`[Claude] Current URL: ${window.location.pathname}`);

  // Check if we're currently viewing a conversation
  if (window.location.pathname.startsWith('/chat/')) {
    console.log('[Claude] Extracting currently open conversation...');
    const currentConversation = await extractCurrentConversation();
    if (currentConversation) {
      conversations.push(currentConversation);
      console.log(`[Claude] Successfully extracted 1 conversation: "${currentConversation.title}"`);
    } else {
      console.warn('[Claude] Failed to extract current conversation');
    }
  }

  // If we want to sync ALL conversations, iterate through sidebar
  // For now, we only sync the current one to avoid UI disruption
  // TODO: Add option to sync all conversations by clicking through them

  return conversations;
}

// Extract the currently visible conversation
async function extractCurrentConversation() {
  const conversationId = window.location.pathname.split('/chat/')[1];

  if (!conversationId) {
    return null;
  }

  console.log(`[Claude] Extracting conversation: ${conversationId}`);

  // Get conversation title
  const title = extractTitle();
  console.log(`[Claude] Title: "${title}"`);

  // Get all messages
  const messages = extractMessages();
  console.log(`[Claude] Extracted ${messages.length} messages`);

  if (messages.length === 0) {
    console.error('[Claude] ERROR: No messages found in conversation!');
    console.error('[Claude] This means the DOM selectors need updating.');
    console.error('[Claude] Please check if messages are visible on the page.');
    return null;
  }

  return {
    conversation_id: conversationId,
    title: title || 'Untitled Conversation',
    source: SERVICE,
    created_at: new Date().toISOString(), // Approximate
    updated_at: new Date().toISOString(),
    messages: messages
  };
}

// Extract conversation title
function extractTitle() {
  // Try multiple selectors
  const selectors = [
    'h1',
    '[data-testid="conversation-title"]',
    '.conversation-title',
    'header h1',
    'header h2'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim()) {
      return element.textContent.trim();
    }
  }

  return 'Untitled Conversation';
}

// Extract all messages from the current conversation
function extractMessages() {
  const messages = [];

  // Use ACTUAL Claude selectors (from real DOM inspection)
  const userMessages = Array.from(document.querySelectorAll('div[data-testid="user-message"]'));
  const claudeMessages = Array.from(document.querySelectorAll('.font-claude-response'));

  console.log(`[Claude] Found ${userMessages.length} user messages`);
  console.log(`[Claude] Found ${claudeMessages.length} Claude messages`);

  // Combine and sort by DOM order
  const allMessageElements = [...userMessages, ...claudeMessages];

  // Sort by position in DOM
  allMessageElements.sort((a, b) => {
    if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    return 1;
  });

  console.log(`[Claude] Total messages after sorting: ${allMessageElements.length}`);

  // Extract each message
  allMessageElements.forEach((element, index) => {
    try {
      // Determine role based on which selector matched
      const isUser = element.matches('div[data-testid="user-message"]');
      const role = isUser ? 'user' : 'assistant';

      const content = element.textContent.trim();
      const timestamp = extractTimestamp(element);

      if (content) {
        messages.push({
          role: role,
          content: content,
          timestamp: timestamp || new Date().toISOString(),
          sequence_number: index
        });
      }
    } catch (error) {
      console.error('[Claude] Failed to extract message:', error);
    }
  });

  console.log(`[Claude] Successfully extracted ${messages.length} messages`);
  return messages;
}

// Note: detectRole() and extractContent() are no longer needed
// We now use specific selectors that tell us the role directly

// Extract timestamp
function extractTimestamp(element) {
  const timeElements = element.querySelectorAll('time');
  if (timeElements.length > 0) {
    const datetime = timeElements[0].getAttribute('datetime');
    if (datetime) {
      return datetime;
    }
    return timeElements[0].textContent.trim();
  }

  // Look for timestamp text patterns
  const text = element.textContent;
  const timePattern = /\d{1,2}:\d{2}\s*(AM|PM)?/i;
  const match = text.match(timePattern);
  if (match) {
    return new Date().toISOString(); // Approximate
  }

  return null;
}

// Show notification to user
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.textContent = message;

  const bgColor = type === 'success' ? '#10b981' :
                  type === 'error' ? '#ef4444' :
                  '#3b82f6'; // blue for info

  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bgColor};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    z-index: 10000;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    font-weight: 500;
  `;

  document.body.appendChild(notification);

  // Remove after duration (longer for info messages)
  const duration = type === 'info' ? 2000 : 3000;
  setTimeout(() => {
    notification.remove();
  }, duration);
}

// Wait for messages to load in DOM
async function waitForMessages(maxWaitMs = 5000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const userMessages = document.querySelectorAll('div[data-testid="user-message"]');
    const claudeMessages = document.querySelectorAll('.font-claude-response');

    if (userMessages.length > 0 || claudeMessages.length > 0) {
      console.log('[Claude] Messages loaded in DOM');
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.warn('[Claude] Timeout waiting for messages');
  return false;
}

// Continue full sync after page navigation (runs on every page load)
async function continueFullSync() {
  const syncState = await chrome.storage.local.get([
    'fullSyncActive',
    'fullSyncConversations',
    'fullSyncIndex',
    'fullSyncSynced',
    'fullSyncFailed',
    'fullSyncOriginalUrl'
  ]);

  if (!syncState.fullSyncActive) {
    console.log('[Claude] No active full sync');
    return false; // Not syncing
  }

  console.log('[Claude] Continuing full sync...');
  debugLog('Continue full sync', { index: syncState.fullSyncIndex, total: syncState.fullSyncConversations.length });

  const { fullSyncConversations, fullSyncIndex, fullSyncOriginalUrl } = syncState;
  let { fullSyncSynced, fullSyncFailed } = syncState;

  // Show progress notification
  const progressNotification = document.createElement('div');
  progressNotification.id = 'claude-sync-progress';
  progressNotification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #3b82f6;
    color: white;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    z-index: 10000;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    font-weight: 500;
    min-width: 200px;
  `;
  progressNotification.textContent = `Syncing ${fullSyncIndex + 1}/${fullSyncConversations.length}...`;
  document.body.appendChild(progressNotification);

  // Wait for messages to load
  console.log('[Claude] Waiting for messages to load...');
  await waitForMessages(5000);

  // Extract and sync current conversation
  try {
    const conversation = await extractCurrentConversation();
    if (conversation && conversation.messages && conversation.messages.length > 0) {
      debugLog('Conversation extracted', { title: conversation.title, messages: conversation.messages.length });

      // Send to backend
      const response = await fetch(`${API_BASE}/api/import/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversations: [conversation] })
      });

      if (response.ok) {
        fullSyncSynced++;
        console.log(`[Claude] ✓ Synced ${fullSyncIndex + 1}/${fullSyncConversations.length}: ${conversation.title} (${conversation.messages.length} msgs)`);
        debugLog('Conversation synced', { title: conversation.title, synced: fullSyncSynced, failed: fullSyncFailed });
      } else {
        fullSyncFailed++;
        console.error(`[Claude] ✗ Failed to sync: ${conversation.title}`);
        debugLog('Sync failed', { title: conversation.title, status: response.status });
      }
    } else {
      fullSyncFailed++;
      console.error('[Claude] Failed to extract conversation or no messages found');
      debugLog('Extract failed', { hasConversation: !!conversation, messageCount: conversation?.messages?.length || 0 });
    }
  } catch (error) {
    fullSyncFailed++;
    console.error(`[Claude] Error syncing:`, error);
    debugLog('Sync error', { error: error.message });
  }

  // Move to next conversation
  const nextIndex = fullSyncIndex + 1;

  if (nextIndex < fullSyncConversations.length) {
    // Update state and navigate to next
    await chrome.storage.local.set({
      fullSyncIndex: nextIndex,
      fullSyncSynced,
      fullSyncFailed
    });

    console.log(`[Claude] Navigating to conversation ${nextIndex + 1}/${fullSyncConversations.length}...`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Delay before navigation
    window.location.href = fullSyncConversations[nextIndex];
  } else {
    // Done! Clean up and show results
    console.log('[Claude] Full sync COMPLETE!');
    debugLog('Full sync complete', { synced: fullSyncSynced, failed: fullSyncFailed });

    await chrome.storage.local.remove([
      'fullSyncActive',
      'fullSyncConversations',
      'fullSyncIndex',
      'fullSyncSynced',
      'fullSyncFailed',
      'fullSyncOriginalUrl'
    ]);

    progressNotification.remove();
    showNotification(`✓ Synced ${fullSyncSynced} conversations (${fullSyncFailed} failed)`, 'success');

    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: { synced: fullSyncSynced, failed: fullSyncFailed, total: fullSyncConversations.length }
    });

    // Return to original page
    await new Promise(resolve => setTimeout(resolve, 2000));
    window.location.href = fullSyncOriginalUrl;
  }

  return true; // Was syncing
}

// Auto-sync when page loads (if enabled)
window.addEventListener('load', async () => {
  // Clean up any old sync state (we now use API sync, not page navigation)
  const syncState = await chrome.storage.local.get(['fullSyncActive']);
  if (syncState.fullSyncActive) {
    console.log('[Claude] Cleaning up old page-based sync state');
    await chrome.storage.local.remove([
      'fullSyncActive',
      'fullSyncConversations',
      'fullSyncIndex',
      'fullSyncSynced',
      'fullSyncFailed',
      'fullSyncOriginalUrl'
    ]);
  }

  // Auto-sync if enabled
  const settings = await chrome.storage.sync.get(['autoSync', 'enabledServices']);
  if (settings.autoSync && settings.enabledServices?.claude) {
    console.log('[Claude] Auto-sync on page load');
    // Wait a bit for page to fully load
    setTimeout(() => performSync(), 2000);
  }
});

console.log('[Claude] Content script loaded successfully!');
console.log('[Claude] Script location:', window.location.href);
console.log('[Claude] Message listener registered and ready');
