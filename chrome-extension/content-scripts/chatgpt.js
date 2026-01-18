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

// Listen for sync requests from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true, loaded: true });
    return true;
  }

  if (request.action === 'sync') {
    performSync()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'syncAll') {
    performSyncAll()
      .catch(error => {
        console.warn('[ChatGPT] Sync all:', error.message);
        showNotification('Sync failed: ' + error.message, 'error');
      });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'syncQuick') {
    performSyncQuick()
      .catch(error => {
        console.warn('[ChatGPT] Quick sync:', error.message);
        showNotification('Quick sync failed: ' + error.message, 'error');
      });
    sendResponse({ success: true });
    return true;
  }
});

// Main sync function - sync current conversation
async function performSync() {
  try {
    if (!isChatGPTPage()) {
      throw new Error('Not on ChatGPT page');
    }

    // Check if backend is reachable
    try {
      const healthCheck = await apiFetch('/api/health');
      if (!healthCheck.ok) {
        throw new Error('Backend not healthy');
      }
    } catch (e) {
      throw new Error('Cannot reach backend');
    }

    // Try to get conversation ID from URL
    const conversationId = getConversationIdFromURL();

    if (conversationId) {
      // Fetch via API
      const apiConversation = await fetchConversationMessages(conversationId);
      const dbConversation = convertChatGPTAPIToDBFormat(apiConversation);

      const response = await apiFetch('/api/import/chatgpt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversations: [dbConversation] })
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const result = await response.json();
      chrome.runtime.sendMessage({ action: 'syncComplete', service: SERVICE, result });
      showNotification('Conversation synced', 'success');
    } else {
      // Fallback: extract from DOM
      const conversation = await extractCurrentConversation();

      if (!conversation || conversation.messages.length === 0) {
        throw new Error('No conversation to sync');
      }

      const response = await apiFetch('/api/import/chatgpt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversations: [conversation] })
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const result = await response.json();
      chrome.runtime.sendMessage({ action: 'syncComplete', service: SERVICE, result });
      showNotification('Conversation synced', 'success');
    }
  } catch (error) {
    // Only log as warning for expected failures (e.g., not on conversation page)
    console.warn('[ChatGPT] Sync skipped:', error.message);
    chrome.runtime.sendMessage({
      action: 'syncError',
      service: SERVICE,
      error: error.message
    });
    // Don't show notification for auto-sync failures - too noisy
    throw error;
  }
}

// Sync ALL conversations using API
async function performSyncAll() {
  try {
    showNotification('Fetching conversations...', 'info');

    const { conversations } = await fetchAllConversationsViaAPI();

    if (conversations.length === 0) {
      showNotification('No conversations found', 'error');
      return;
    }

    showNotification(`Syncing ${conversations.length} conversations...`, 'info');

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

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];
      const convId = conv.id;
      const convTitle = conv.title || 'Untitled';

      progressNotification.textContent = `Syncing ${i + 1}/${conversations.length}: ${convTitle}`;

      try {
        const fullConversation = await fetchConversationMessages(convId);
        const dbConversation = convertChatGPTAPIToDBFormat(fullConversation);

        const response = await apiFetch('/api/import/chatgpt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: [dbConversation] })
        });

        if (response.ok) {
          synced++;
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
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
    const resultMsg = failed > 0
      ? `Synced ${synced}/${conversations.length} (${failed} skipped)`
      : `Synced ${synced} conversations`;
    showNotification(resultMsg, 'success');
    console.log(`[ChatGPT] Sync complete: ${synced} synced, ${failed} skipped`);

    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: { synced, failed, total: conversations.length }
    });

  } catch (error) {
    console.warn('[ChatGPT] Sync failed:', error.message);
    const progressNotification = document.getElementById('chatgpt-sync-progress');
    if (progressNotification) progressNotification.remove();
    showNotification('Sync failed: ' + error.message, 'error');
    throw error;
  }
}

// Perform quick incremental sync - only sync new/updated conversations
async function performSyncQuick() {
  try {
    showNotification('Checking for updates...', 'info');

    const syncState = await getChatGPTSyncState();
    const quickSyncDepth = syncState.quickSyncDepth || 50;
    const lastKnownId = syncState.lastKnownConversationId;

    const { conversations } = await fetchAllConversationsViaAPI({
      maxLimit: quickSyncDepth,
      stopAtConversationId: lastKnownId
    });

    if (conversations.length === 0) {
      if (lastKnownId) {
        showNotification('All up to date!', 'success');
        chrome.runtime.sendMessage({ action: 'syncComplete', service: SERVICE, result: { synced: 0, failed: 0, total: 0 } });
        return;
      } else {
        showNotification('No conversations found', 'error');
        return;
      }
    }

    // Build check payload
    const checkPayload = conversations.map(conv => ({
      conversation_id: conv.id,
      source: 'chatgpt',
      updated_at: conv.update_time ?
        (typeof conv.update_time === 'number' ?
          new Date(conv.update_time * 1000).toISOString() :
          conv.update_time) :
        null
    })).filter(item => item.conversation_id);

    // Check with backend which need syncing
    const checkResponse = await apiFetch('/api/conversations/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations: checkPayload })
    });

    if (!checkResponse.ok) {
      throw new Error(`Backend check failed: ${checkResponse.status}`);
    }

    const checkResult = await checkResponse.json();
    const needsSyncIds = new Set(checkResult.needs_sync || []);

    if (needsSyncIds.size === 0) {
      if (conversations.length > 0) {
        await setChatGPTLastSyncedConversation(conversations[0].id, 'quick');
      }
      showNotification('All up to date!', 'success');
      chrome.runtime.sendMessage({ action: 'syncComplete', service: SERVICE, result: { synced: 0, failed: 0, total: conversations.length } });
      return;
    }

    const conversationsToSync = conversations.filter(conv => needsSyncIds.has(conv.id));
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

    for (let i = 0; i < conversationsToSync.length; i++) {
      const conv = conversationsToSync[i];
      const convId = conv.id;
      const convTitle = conv.title || 'Untitled';

      progressNotification.textContent = `${i + 1}/${conversationsToSync.length}: ${convTitle}`;

      try {
        const fullConversation = await fetchConversationMessages(convId);
        const dbConversation = convertChatGPTAPIToDBFormat(fullConversation);

        const response = await apiFetch('/api/import/chatgpt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: [dbConversation] })
        });

        if (response.ok) {
          synced++;
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    progressNotification.remove();

    if (conversations.length > 0) {
      await setChatGPTLastSyncedConversation(conversations[0].id, 'quick');
    }

    const resultMsg = failed > 0
      ? `Quick sync: ${synced}/${conversationsToSync.length} (${failed} skipped)`
      : `Quick sync: ${synced} conversations`;
    showNotification(resultMsg, 'success');

    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: { synced, failed, total: conversationsToSync.length }
    });

  } catch (error) {
    console.warn('[ChatGPT] Quick sync failed:', error.message);
    const progressNotification = document.getElementById('chatgpt-sync-progress');
    if (progressNotification) progressNotification.remove();
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
  // Skip editor/creation pages
  if (window.location.pathname.includes('/gpts/editor')) {
    return null;
  }

  // Try standard conversation URL: /c/{id}
  let match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/i);
  if (match) return match[1];

  // Try custom GPT conversation URL: /g/{gpt-id}/c/{conversation-id}
  match = window.location.pathname.match(/\/g\/[^/]+\/c\/([a-f0-9-]+)/i);
  if (match) return match[1];

  return null;
}

// Extract current conversation from DOM (fallback method)
async function extractCurrentConversation() {
  const conversationId = getConversationIdFromURL() || `chatgpt-${Date.now()}`;
  const title = extractTitle();
  const messages = extractMessages();

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

  messageElements.forEach((element) => {
    const role = element.getAttribute('data-message-author-role');
    if (role === 'system') return;

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
    const userMsgs = document.querySelectorAll('[data-testid^="conversation-turn-"] [data-message-author-role="user"]');
    const assistantMsgs = document.querySelectorAll('[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]');
    const allMsgs = [...userMsgs, ...assistantMsgs];

    allMsgs.sort((a, b) => {
      if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
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
  const settings = await chrome.storage.sync.get(['autoSync', 'enabledServices']);
  if (settings.autoSync && settings.enabledServices?.chatgpt) {
    setTimeout(() => performSync(), 2000);
  }
});
