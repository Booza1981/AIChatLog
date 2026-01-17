/**
 * ChatGPT Content Script
 * Extracts conversation data from ChatGPT
 *
 * Supports:
 * - Single conversation sync (DOM extraction)
 * - Full sync (all conversations via API)
 * - Quick sync (incremental sync via API)
 */

const SERVICE = 'chatgpt';
const API_BASE = 'http://localhost:8000';

// Listen for sync requests from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    console.log('[ChatGPT] Ping received');
    sendResponse({ success: true, loaded: true });
    return true;
  }

  if (request.action === 'sync') {
    console.log('[ChatGPT] Sync requested');
    performSync()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'syncAll') {
    console.log('[ChatGPT] Sync ALL conversations requested');
    performSyncAll()
      .catch(error => {
        console.error('[ChatGPT] Sync all error:', error);
        showNotification('Sync failed: ' + error.message, 'error');
      });
    sendResponse({ success: true, message: 'Sync started - watch for notifications' });
    return true;
  }

  if (request.action === 'syncQuick') {
    console.log('[ChatGPT] Quick sync (incremental) requested');
    performSyncQuick()
      .catch(error => {
        console.error('[ChatGPT] Quick sync error:', error);
        showNotification('Quick sync failed: ' + error.message, 'error');
      });
    sendResponse({ success: true, message: 'Quick sync started - watch for notifications' });
    return true;
  }
});

// Main sync function - sync current conversation
async function performSync() {
  try {
    console.log('[ChatGPT] Starting conversation sync...');
    console.log('[ChatGPT] Current page:', window.location.href);

    // Check if we're on the right page
    if (!isChatGPTPage()) {
      throw new Error('Not on ChatGPT page. Please navigate to chatgpt.com');
    }

    // Check if backend is reachable
    try {
      const healthCheck = await fetch(`${API_BASE}/api/health`);
      if (!healthCheck.ok) {
        throw new Error(`Backend not healthy (status: ${healthCheck.status}). Make sure Docker is running.`);
      }
      console.log('[ChatGPT] Backend is healthy');
    } catch (e) {
      throw new Error(`Cannot reach backend at ${API_BASE}. Make sure Docker containers are running: docker-compose up -d`);
    }

    // Try to get conversation ID from URL
    const conversationId = getConversationIdFromURL();

    if (conversationId) {
      // If we have a conversation ID, fetch it via API
      console.log('[ChatGPT] Fetching current conversation via API...');
      const apiConversation = await fetchConversationMessages(conversationId);
      const dbConversation = convertChatGPTAPIToDBFormat(apiConversation);

      // Send to backend
      const response = await fetch(`${API_BASE}/api/import/chatgpt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversations: [dbConversation] })
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const result = await response.json();
      console.log('[ChatGPT] Sync complete:', result);

      chrome.runtime.sendMessage({
        action: 'syncComplete',
        service: SERVICE,
        result: result
      });

      showNotification('ChatGPT conversation synced', 'success');
    } else {
      // Fallback: extract from DOM
      console.log('[ChatGPT] No conversation ID in URL, trying DOM extraction...');
      const conversation = await extractCurrentConversation();

      if (!conversation || conversation.messages.length === 0) {
        throw new Error('Could not extract conversation. Please open a conversation first.');
      }

      // Send to backend
      const response = await fetch(`${API_BASE}/api/import/chatgpt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversations: [conversation] })
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const result = await response.json();
      console.log('[ChatGPT] Sync complete:', result);

      chrome.runtime.sendMessage({
        action: 'syncComplete',
        service: SERVICE,
        result: result
      });

      showNotification('ChatGPT conversation synced', 'success');
    }
  } catch (error) {
    console.error('[ChatGPT] Sync failed:', error);
    chrome.runtime.sendMessage({
      action: 'syncError',
      service: SERVICE,
      error: error.message
    });
    showNotification('Sync failed: ' + error.message, 'error');
    throw error;
  }
}

// Sync ALL conversations using API
async function performSyncAll() {
  try {
    console.log('[ChatGPT] ========== performSyncAll() CALLED (API MODE) ==========');

    showNotification('Fetching conversations via API...', 'info');

    // Fetch all conversations via API
    const { conversations } = await fetchAllConversationsViaAPI();

    console.log(`[ChatGPT] Got ${conversations.length} conversations from API`);

    if (conversations.length === 0) {
      showNotification('No conversations found', 'error');
      return;
    }

    showNotification(`Syncing ${conversations.length} conversations via API...`, 'info');

    // Create persistent progress notification
    const progressNotification = document.createElement('div');
    progressNotification.id = 'chatgpt-sync-progress';
    progressNotification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #10a37f;
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

    // Sync each conversation via API
    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];
      const convId = conv.id;
      const convTitle = conv.title || 'Untitled';

      progressNotification.textContent = `Syncing ${i + 1}/${conversations.length}: ${convTitle}`;
      console.log(`[ChatGPT] Syncing ${i + 1}/${conversations.length}: ${convId}`);

      try {
        // Fetch full conversation with messages
        const fullConversation = await fetchConversationMessages(convId);

        // Convert to our format
        const dbConversation = convertChatGPTAPIToDBFormat(fullConversation);

        console.log(`[ChatGPT] Fetched conversation: ${dbConversation.title} (${dbConversation.messages.length} messages)`);

        // Send to backend
        const response = await fetch(`${API_BASE}/api/import/chatgpt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: [dbConversation] })
        });

        if (response.ok) {
          synced++;
          console.log(`[ChatGPT] Synced: ${dbConversation.title}`);
        } else {
          failed++;
          console.error(`[ChatGPT] Failed to save: ${dbConversation.title}`);
        }
      } catch (error) {
        failed++;
        console.error(`[ChatGPT] Error syncing ${convId}:`, error);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Remove progress notification
    progressNotification.remove();

    // Update sync state
    if (conversations.length > 0) {
      await setChatGPTLastSyncedConversation(conversations[0].id, 'full');
    }

    // Show final result
    showNotification(`Synced ${synced}/${conversations.length} conversations! (${failed} failed)`, 'success');
    console.log(`[ChatGPT] API sync complete: ${synced} synced, ${failed} failed out of ${conversations.length} total`);

    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: { synced, failed, total: conversations.length }
    });

  } catch (error) {
    console.error('[ChatGPT] Full sync FAILED with error:', error);
    console.error('[ChatGPT] Error stack:', error.stack);

    // Remove progress notification if it exists
    const progressNotification = document.getElementById('chatgpt-sync-progress');
    if (progressNotification) {
      progressNotification.remove();
    }

    showNotification('Full sync failed: ' + error.message, 'error');
    throw error;
  }
}

// Perform quick incremental sync - only sync new/updated conversations
async function performSyncQuick() {
  try {
    console.log('[ChatGPT] ========== performSyncQuick() CALLED (SMART INCREMENTAL MODE) ==========');

    showNotification('Fetching conversations for quick sync...', 'info');

    // Load sync state
    const syncState = await getChatGPTSyncState();
    const quickSyncDepth = syncState.quickSyncDepth || 50;
    const lastKnownId = syncState.lastKnownConversationId;

    console.log(`[ChatGPT] Sync state: depth=${quickSyncDepth}, lastKnownId=${lastKnownId || 'none'}`);

    // Fetch conversations with smart filtering
    const { conversations } = await fetchAllConversationsViaAPI({
      maxLimit: quickSyncDepth,
      stopAtConversationId: lastKnownId
    });

    console.log(`[ChatGPT] Got ${conversations.length} conversations from API for quick sync`);

    // If no conversations returned and we had a lastKnownId, we're up to date
    if (conversations.length === 0) {
      if (lastKnownId) {
        showNotification('All conversations up to date!', 'success');
        console.log('[ChatGPT] No new conversations since last sync');
        chrome.runtime.sendMessage({
          action: 'syncComplete',
          service: SERVICE,
          result: { synced: 0, failed: 0, total: 0 }
        });
        return;
      } else {
        showNotification('No conversations found', 'error');
        return;
      }
    }

    // Build check payload with conversation IDs and timestamps
    const checkPayload = conversations.map(conv => ({
      conversation_id: conv.id,
      source: 'chatgpt',
      updated_at: conv.update_time ?
        (typeof conv.update_time === 'number' ?
          new Date(conv.update_time * 1000).toISOString() :
          conv.update_time) :
        null
    })).filter(item => item.conversation_id);

    console.log(`[ChatGPT] Checking ${checkPayload.length} conversations with backend...`);
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

    console.log(`[ChatGPT] Backend says ${needsSyncIds.size} conversations need syncing`);

    if (needsSyncIds.size === 0) {
      // Update state even when nothing needs syncing
      if (conversations.length > 0) {
        await setChatGPTLastSyncedConversation(conversations[0].id, 'quick');
        console.log(`[ChatGPT] Updated last known conversation to: ${conversations[0].id}`);
      }
      showNotification('All conversations up to date!', 'success');
      chrome.runtime.sendMessage({
        action: 'syncComplete',
        service: SERVICE,
        result: { synced: 0, failed: 0, total: conversations.length }
      });
      return;
    }

    // Filter to only conversations that need syncing
    const conversationsToSync = conversations.filter(conv => needsSyncIds.has(conv.id));

    console.log(`[ChatGPT] Will sync ${conversationsToSync.length} conversations`);
    showNotification(`Syncing ${conversationsToSync.length} conversations...`, 'info');

    // Create persistent progress notification
    const progressNotification = document.createElement('div');
    progressNotification.id = 'chatgpt-sync-progress';
    progressNotification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #10a37f;
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
      const convId = conv.id;
      const convTitle = conv.title || 'Untitled';

      progressNotification.textContent = `Quick sync ${i + 1}/${conversationsToSync.length}: ${convTitle}`;
      console.log(`[ChatGPT] Syncing ${i + 1}/${conversationsToSync.length}: ${convId}`);

      try {
        // Fetch full conversation with messages
        const fullConversation = await fetchConversationMessages(convId);

        // Convert to our format
        const dbConversation = convertChatGPTAPIToDBFormat(fullConversation);

        // Send to backend
        const response = await fetch(`${API_BASE}/api/import/chatgpt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: [dbConversation] })
        });

        if (response.ok) {
          synced++;
          console.log(`[ChatGPT] Synced: ${dbConversation.title}`);
        } else {
          failed++;
          console.error(`[ChatGPT] Failed to save: ${dbConversation.title}`);
        }
      } catch (error) {
        failed++;
        console.error(`[ChatGPT] Error syncing ${convId}:`, error);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Remove progress notification
    progressNotification.remove();

    // Update sync state with the most recent conversation
    if (conversations.length > 0) {
      await setChatGPTLastSyncedConversation(conversations[0].id, 'quick');
      console.log(`[ChatGPT] Updated last known conversation to: ${conversations[0].id}`);
    }

    // Show final result
    showNotification(`Quick sync: ${synced}/${conversationsToSync.length} synced! (${failed} failed)`, 'success');
    console.log(`[ChatGPT] Quick sync complete: ${synced} synced, ${failed} failed out of ${conversationsToSync.length} needed`);

    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: { synced, failed, total: conversationsToSync.length }
    });

  } catch (error) {
    console.error('[ChatGPT] Quick sync FAILED with error:', error);
    console.error('[ChatGPT] Error stack:', error.stack);

    // Remove progress notification if it exists
    const progressNotification = document.getElementById('chatgpt-sync-progress');
    if (progressNotification) {
      progressNotification.remove();
    }

    showNotification('Quick sync failed: ' + error.message, 'error');
    throw error;
  }
}

// Check if we're on a ChatGPT page
function isChatGPTPage() {
  return window.location.hostname.includes('chatgpt.com') ||
         window.location.hostname.includes('chat.openai.com');
}

// Get conversation ID from URL
function getConversationIdFromURL() {
  // ChatGPT URL formats:
  // - https://chatgpt.com/c/{conversation-id}
  // - https://chatgpt.com/g/{gpt-id}/c/{conversation-id} (for custom GPTs)
  // - https://chatgpt.com/gpts/editor/{id} (for GPT editor - skip these)

  console.log('[ChatGPT] Parsing URL:', window.location.pathname);

  // Skip editor/creation pages
  if (window.location.pathname.includes('/gpts/editor')) {
    console.log('[ChatGPT] On GPT editor page, no conversation to sync');
    return null;
  }

  // Try standard conversation URL: /c/{id}
  let match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/i);
  if (match) {
    console.log('[ChatGPT] Found conversation ID in standard URL:', match[1]);
    return match[1];
  }

  // Try custom GPT conversation URL: /g/{gpt-id}/c/{conversation-id}
  match = window.location.pathname.match(/\/g\/[^/]+\/c\/([a-f0-9-]+)/i);
  if (match) {
    console.log('[ChatGPT] Found conversation ID in custom GPT URL:', match[1]);
    return match[1];
  }

  console.log('[ChatGPT] No conversation ID found in URL');
  return null;
}

// Extract current conversation from DOM (fallback method)
async function extractCurrentConversation() {
  console.log('[ChatGPT] Extracting current conversation from DOM...');

  const conversationId = getConversationIdFromURL() || `chatgpt-${Date.now()}`;
  const title = extractTitle();
  const messages = extractMessages();

  console.log(`[ChatGPT] Extracted: ${title} (${messages.length} messages)`);

  return {
    conversation_id: conversationId,
    title: title || 'Untitled Conversation',
    source: SERVICE,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: messages
  };
}

// Extract conversation title from DOM
function extractTitle() {
  // Try multiple selectors for title
  const selectors = [
    'h1',
    '[data-testid="conversation-turn-0"] h1',
    'nav [aria-selected="true"]',
    '.text-token-text-primary'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim()) {
      const text = element.textContent.trim();
      // Avoid capturing navigation elements
      if (text.length > 2 && text.length < 200) {
        return text;
      }
    }
  }

  return 'Untitled Conversation';
}

// Extract messages from DOM
function extractMessages() {
  const messages = [];

  // ChatGPT uses data-message-author-role attribute
  const messageElements = document.querySelectorAll('[data-message-author-role]');

  console.log(`[ChatGPT] Found ${messageElements.length} message elements`);

  messageElements.forEach((element, index) => {
    const role = element.getAttribute('data-message-author-role');

    // Skip system messages
    if (role === 'system') return;

    // Get content
    const content = element.textContent.trim();

    if (content) {
      messages.push({
        role: role === 'user' ? 'user' : 'assistant',
        content: content,
        timestamp: new Date().toISOString(),
        sequence_number: messages.length
      });
    }
  });

  // Fallback: try alternative selectors
  if (messages.length === 0) {
    console.log('[ChatGPT] Trying alternative selectors...');

    // Try finding user and assistant message containers
    const userMsgs = document.querySelectorAll('[data-testid^="conversation-turn-"] [data-message-author-role="user"]');
    const assistantMsgs = document.querySelectorAll('[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]');

    const allMsgs = [...userMsgs, ...assistantMsgs];

    // Sort by DOM position
    allMsgs.sort((a, b) => {
      if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }
      return 1;
    });

    allMsgs.forEach((element, index) => {
      const role = element.getAttribute('data-message-author-role');
      const content = element.textContent.trim();

      if (content && role !== 'system') {
        messages.push({
          role: role === 'user' ? 'user' : 'assistant',
          content: content,
          timestamp: new Date().toISOString(),
          sequence_number: index
        });
      }
    });
  }

  console.log(`[ChatGPT] Extracted ${messages.length} messages`);
  return messages;
}

// Show notification to user
function showNotification(message, type = 'info') {
  // Remove any existing notification
  const existing = document.getElementById('chatgpt-sync-notification');
  if (existing) {
    existing.remove();
  }

  const notification = document.createElement('div');
  notification.id = 'chatgpt-sync-notification';
  notification.textContent = message;

  const bgColor = type === 'success' ? '#10a37f' :
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

  // Remove after duration
  const duration = type === 'info' ? 2000 : 3000;
  setTimeout(() => {
    notification.remove();
  }, duration);
}

// Auto-sync when page loads (if enabled)
window.addEventListener('load', async () => {
  // Auto-sync if enabled
  const settings = await chrome.storage.sync.get(['autoSync', 'enabledServices']);
  if (settings.autoSync && settings.enabledServices?.chatgpt) {
    console.log('[ChatGPT] Auto-sync on page load');
    // Wait a bit for page to fully load
    setTimeout(() => performSync(), 2000);
  }
});

console.log('[ChatGPT] Content script loaded successfully!');
console.log('[ChatGPT] Script location:', window.location.href);
