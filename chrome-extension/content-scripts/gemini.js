/**
 * Gemini Content Script
 * Extracts conversation data from Gemini DOM
 *
 * DOM Structure (as of 2024):
 * - Chat list: conversations-list
 * - Individual chat: div[data-test-id="conversation"]
 * - Chat title: div[data-test-id="conversation"] .conversation-title
 * - Main chat: div#chat-history
 * - User prompts: user-query
 * - Model responses: model-response
 */

const SERVICE = 'gemini';

// Listen for sync requests from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    console.log('[Gemini] Ping received');
    sendResponse({ success: true, loaded: true });
    return true;
  }

  if (request.action === 'sync') {
    console.log('[Gemini] Sync requested');
    performSync()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (request.action === 'syncAll') {
    console.log('[Gemini] Sync ALL conversations requested');
    performSyncAll()
      .catch(error => {
        console.error('[Gemini] Sync all error:', error);
        showNotification('✗ Full sync failed: ' + error.message, 'error');
      });
    sendResponse({ success: true, message: 'Sync started - watch for notifications' });
    return true;
  }

  if (request.action === 'syncQuick') {
    console.log('[Gemini] Quick sync (incremental) requested');
    performSyncQuick()
      .catch(error => {
        console.error('[Gemini] Quick sync error:', error);
        showNotification('✗ Quick sync failed: ' + error.message, 'error');
      });
    sendResponse({ success: true, message: 'Quick sync started - watch for notifications' });
    return true;
  }
});

// Main sync function
async function performSync() {
  try {
    console.log('[Gemini] Starting conversation sync...');
    console.log('[Gemini] Current page:', window.location.href);

    // Check if we're on the right page
    if (!isGeminiChatPage()) {
      throw new Error('Not on Gemini chat page. Please navigate to gemini.google.com');
    }

    // Check if backend is reachable
    try {
      const healthCheck = await apiFetch('/api/health');
      if (!healthCheck.ok) {
        throw new Error(`Backend not healthy (status: ${healthCheck.status}). Make sure Docker is running.`);
      }
      console.log('[Gemini] Backend is healthy');
    } catch (e) {
      const apiBase = await getApiBase();
      throw new Error(`Cannot reach backend at ${apiBase}. Make sure Docker containers are running: docker-compose up -d`);
    }

    // Extract current conversation
    const conversation = await extractCurrentConversation();

    if (!conversation) {
      throw new Error('Could not extract conversation. Make sure you have an active conversation open.');
    }

    console.log(`[Gemini] Extracted conversation with ${conversation.messages.length} messages`);

    // Send to backend
    const response = await apiFetch('/api/import/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations: [conversation] })
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const result = await response.json();
    console.log('[Gemini] Sync complete:', result);

    // Show success notification
    showNotification('✓ Gemini conversation synced', 'success');

    // Notify background script
    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: result
    });

  } catch (error) {
    console.error('[Gemini] Sync failed:', error);
    showNotification('✗ Sync failed: ' + error.message, 'error');

    chrome.runtime.sendMessage({
      action: 'syncError',
      service: SERVICE,
      error: error.message
    });

    throw error;
  }
}

// Check if we're on a Gemini chat page
function isGeminiChatPage() {
  return window.location.hostname.includes('gemini.google.com');
}

// Extract the currently visible conversation
async function extractCurrentConversation() {
  console.log('[Gemini] Extracting current conversation...');

  // Get conversation ID from URL or generate one
  const conversationId = getConversationId();

  if (!conversationId) {
    console.error('[Gemini] Could not determine conversation ID');
    return null;
  }

  console.log(`[Gemini] Conversation ID: ${conversationId}`);

  // Get conversation title
  const title = extractTitle();
  console.log(`[Gemini] Title: "${title}"`);

  // Get all messages
  const messages = extractMessages();
  console.log(`[Gemini] Extracted ${messages.length} messages`);

  if (messages.length === 0) {
    console.error('[Gemini] ERROR: No messages found in conversation!');
    console.error('[Gemini] The DOM selectors may need updating.');
    return null;
  }

  return {
    conversation_id: conversationId,
    title: title || 'Untitled Conversation',
    source: SERVICE,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: messages
  };
}

// Get conversation ID from URL or DOM
function getConversationId() {
  // Try to extract from URL
  // Gemini URLs typically look like: https://gemini.google.com/app/...
  const urlMatch = window.location.pathname.match(/\/app\/([^\/]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // Fallback: Try to find it in the selected conversation in sidebar
  const selectedConv = document.querySelector('div[data-test-id="conversation"].selected');
  if (selectedConv) {
    // Try to get an ID from data attributes
    const id = selectedConv.getAttribute('data-conversation-id') ||
               selectedConv.getAttribute('id') ||
               selectedConv.getAttribute('data-id');
    if (id) return id;
  }

  // Last resort: use timestamp + random number
  return `gemini-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Extract conversation title
function extractTitle() {
  // Try multiple selectors for title
  const selectors = [
    'div[data-test-id="conversation"].selected .conversation-title',
    '.conversation-title',
    'h1',
    'header h1',
    '[role="heading"]'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim()) {
      return element.textContent.trim();
    }
  }

  // Fallback: use first user message as title
  const firstUserQuery = document.querySelector('user-query');
  if (firstUserQuery) {
    const text = firstUserQuery.textContent.trim();
    return text.substring(0, 100) + (text.length > 100 ? '...' : '');
  }

  return 'Untitled Conversation';
}

// Extract all messages from the current conversation
function extractMessages() {
  const messages = [];

  // Check for chat history container
  const chatHistory = document.querySelector('div#chat-history');
  if (!chatHistory) {
    console.warn('[Gemini] No chat history container found (div#chat-history)');
    console.warn('[Gemini] Trying alternative selectors...');
  }

  // Get user queries and model responses
  const userQueries = Array.from(document.querySelectorAll('user-query'));
  const modelResponses = Array.from(document.querySelectorAll('model-response'));

  console.log(`[Gemini] Found ${userQueries.length} user queries`);
  console.log(`[Gemini] Found ${modelResponses.length} model responses`);

  // Combine and sort by DOM order
  const allMessageElements = [
    ...userQueries.map(el => ({ element: el, role: 'user' })),
    ...modelResponses.map(el => ({ element: el, role: 'assistant' }))
  ];

  // Sort by position in DOM
  allMessageElements.sort((a, b) => {
    if (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    return 1;
  });

  console.log(`[Gemini] Total messages after sorting: ${allMessageElements.length}`);

  // Extract each message
  allMessageElements.forEach((item, index) => {
    try {
      const { element, role } = item;
      let content = '';

      if (role === 'user') {
        // Try to find query-text within user-query
        const queryText = element.querySelector('div[class*="query-text"]') ||
                         element.querySelector('.query-text');
        content = queryText ? getCleanTextContent(queryText) : getCleanTextContent(element);
      } else {
        // For model responses, try to find markdown content
        const markdownContent = element.querySelector('message-content div[class*="markdown"]') ||
                               element.querySelector('message-content') ||
                               element.querySelector('.markdown');
        content = markdownContent ? getCleanTextContent(markdownContent) : getCleanTextContent(element);
      }

      if (content) {
        messages.push({
          role: role,
          content: content,
          timestamp: new Date().toISOString(), // Gemini doesn't always show timestamps
          sequence_number: index
        });
      }
    } catch (error) {
      console.error('[Gemini] Failed to extract message:', error);
    }
  });

  console.log(`[Gemini] Successfully extracted ${messages.length} messages`);
  return messages;
}

// Get clean text content without SVGs, buttons, and other noise
function getCleanTextContent(element) {
  // Clone the element to avoid modifying the original
  const clone = element.cloneNode(true);

  // Remove all SVG elements (icons, logos)
  const svgs = clone.querySelectorAll('svg');
  svgs.forEach(svg => svg.remove());

  // Remove buttons and interactive elements
  const buttons = clone.querySelectorAll('button');
  buttons.forEach(btn => btn.remove());

  // Remove any elements with role="img" (usually icons)
  const imgElements = clone.querySelectorAll('[role="img"]');
  imgElements.forEach(img => img.remove());

  // Remove elements with common icon class patterns
  const iconElements = clone.querySelectorAll('[class*="icon"], [class*="Icon"]');
  iconElements.forEach(icon => icon.remove());

  // Remove script tags and style tags
  const scripts = clone.querySelectorAll('script, style');
  scripts.forEach(s => s.remove());

  // Remove elements that might contain console errors (look for error-like content)
  const errorLikeElements = clone.querySelectorAll('[class*="error"], [class*="warning"], [class*="console"]');
  errorLikeElements.forEach(el => el.remove());

  // Get the clean text using innerText (respects CSS visibility)
  let text = clone.innerText.trim();

  // Additional text-based filtering to remove console-like messages
  // Split into lines and filter out lines that look like console errors
  const lines = text.split('\n');
  const cleanedLines = lines.filter(line => {
    const trimmedLine = line.trim();

    // Skip lines that look like console errors or warnings
    if (trimmedLine.startsWith('Loading the script')) return false;
    if (trimmedLine.includes('violates the following Content Security Policy')) return false;
    if (trimmedLine.includes('googletagmanager')) return false;
    if (trimmedLine.includes('GTM-')) return false;
    if (trimmedLine.includes('Content-Type')) return false;
    if (trimmedLine.includes('X-Frame-Options')) return false;
    if (trimmedLine.match(/^https?:\/\//)) return false; // Skip lines that are just URLs

    return true;
  });

  return cleanedLines.join('\n').trim();
}

// Show notification to user
function showNotification(message, type = 'info') {
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

  // Remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Sync ALL conversations using API (like Claude's approach)
async function performSyncAll() {
  try {
    console.log('[Gemini] ========== performSyncAll() CALLED (API MODE) ==========');

    // Show notification
    showNotification('Fetching conversations via API...', 'info');

    // Fetch all conversations via API
    const conversationsData = await fetchAllConversationsViaAPI();
    console.log('[Gemini API] Got conversations data:', conversationsData);

    // Parse the conversation list from the response
    // Gemini's MaZiqc response format: [null, "continuationToken", [conversations]]
    let conversations = [];

    if (Array.isArray(conversationsData) && conversationsData.length >= 3) {
      // Format: [null, "token", [conversations]]
      const possibleConversations = conversationsData[2];
      if (Array.isArray(possibleConversations)) {
        conversations = possibleConversations;
        console.log('[Gemini] Extracted conversations from index 2');
      } else {
        console.error('[Gemini] Index 2 is not an array:', possibleConversations);
      }
    } else if (Array.isArray(conversationsData)) {
      // Fallback: maybe it's just an array of conversations
      conversations = conversationsData;
    } else if (conversationsData.conversations) {
      conversations = conversationsData.conversations;
    } else if (conversationsData.chats) {
      conversations = conversationsData.chats;
    } else {
      console.error('[Gemini] Unknown data structure:', conversationsData);
      throw new Error('Could not parse conversation list from API response. Check console for data structure.');
    }

    console.log(`[Gemini] Parsed ${conversations.length} conversations`);

    if (conversations.length === 0) {
      showNotification('No conversations found', 'error');
      return;
    }

    // Log first few conversations to understand structure
    console.log('[Gemini] First conversation sample:', conversations[0]);
    if (conversations.length > 1) {
      console.log('[Gemini] Second conversation sample:', conversations[1]);
    }

    // Gemini conversation structure: [id, title, null, null, null, [timestamp], null, null, null, type]
    console.log('[Gemini] Conversation structure identified:', {
      'index 0': 'conversation_id',
      'index 1': 'title',
      'index 5': 'timestamp array'
    });

    // Update notification
    showNotification(`Syncing ${conversations.length} conversations via API...`, 'info');

    // Create persistent progress notification
    const progressNotification = document.createElement('div');
    progressNotification.id = 'gemini-sync-progress';
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

    // Sync each conversation via API
    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];

      // Gemini conversation structure: [id, title, null, null, null, [timestamp], ...]
      const convId = Array.isArray(conv) ? conv[0] : (conv.id || conv.conversation_id || conv.uuid);
      const convTitle = Array.isArray(conv) ? conv[1] : (conv.title || conv.name || 'Untitled');

      if (!convId) {
        console.error('[Gemini] Skipping conversation with no ID:', conv);
        failed++;
        continue;
      }

      progressNotification.textContent = `Syncing ${i + 1}/${conversations.length}: ${convTitle}`;
      console.log(`[Gemini] Syncing ${i + 1}/${conversations.length}: ${convId} - "${convTitle}"`);

      try {
        // Fetch full conversation with messages
        const fullConversation = await fetchConversationMessages(convId);

        // Convert to our format
        const dbConversation = convertGeminiAPIToDBFormat(fullConversation, convId, convTitle);

        console.log(`[Gemini] Fetched conversation: ${dbConversation.title} (${dbConversation.messages.length} messages)`);

        // Send to backend
        const response = await apiFetch('/api/import/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: [dbConversation] })
        });

        if (response.ok) {
          synced++;
          console.log(`[Gemini] ✓ Synced: ${dbConversation.title}`);
        } else {
          failed++;
          console.error(`[Gemini] ✗ Failed to save: ${dbConversation.title}`);
        }
      } catch (error) {
        failed++;
        console.error(`[Gemini] Error syncing ${convId}:`, error);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Remove progress notification
    progressNotification.remove();

    // Show final result
    showNotification(`✓ Synced ${synced}/${conversations.length} conversations! (${failed} failed)`, 'success');
    console.log(`[Gemini] API sync complete: ${synced} synced, ${failed} failed out of ${conversations.length} total`);

    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: { synced, failed, total: conversations.length }
    });

  } catch (error) {
    console.error('[Gemini] Full sync FAILED with error:', error);
    console.error('[Gemini] Error stack:', error.stack);

    // Remove progress notification if it exists
    const progressNotification = document.getElementById('gemini-sync-progress');
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
    console.log('[Gemini] ========== performSyncQuick() CALLED (INCREMENTAL MODE) ==========');

    // Show notification
    showNotification('Fetching conversations for quick sync...', 'info');

    // NEW: Get sync state to determine pagination options
    const syncState = await getSyncState();
    const quickSyncDepth = syncState.quickSyncDepth || 50;
    const maxPages = Math.ceil(quickSyncDepth / 20); // 20 conversations per page

    console.log(`[Gemini] Quick sync depth: ${quickSyncDepth} conversations (${maxPages} pages max)`);
    if (syncState.lastKnownConversationId) {
      console.log(`[Gemini] Last synced conversation: ${syncState.lastKnownConversationId}`);
    }

    // Fetch conversations via API with smart pagination
    const conversationsData = await fetchAllConversationsViaAPI({
      maxPages: maxPages,
      stopAtConversationId: syncState.lastKnownConversationId
    });
    console.log('[Gemini API] Got conversations data for quick sync:', conversationsData);

    // Parse the conversation list
    let conversations = [];

    if (Array.isArray(conversationsData) && conversationsData.length >= 3) {
      const possibleConversations = conversationsData[2];
      if (Array.isArray(possibleConversations)) {
        conversations = possibleConversations;
        console.log('[Gemini] Extracted conversations from index 2');
      }
    } else if (Array.isArray(conversationsData)) {
      conversations = conversationsData;
    }

    console.log(`[Gemini] Parsed ${conversations.length} conversations for quick sync`);

    if (conversations.length === 0) {
      showNotification('No conversations found', 'error');
      return;
    }

    // Build check payload with conversation IDs and timestamps
    const checkPayload = conversations.map(conv => {
      const convId = Array.isArray(conv) ? conv[0] : (conv.id || conv.conversation_id);
      // Gemini conversation list has timestamp at index 5, which is an array [seconds, nanos]
      // (Note: individual messages from hNvQHb have timestamps at index 4)
      const timestampArray = Array.isArray(conv) && conv[5];
      let updated_at = null;

      if (Array.isArray(timestampArray) && timestampArray[0]) {
        // Convert Unix timestamp to ISO string
        updated_at = new Date(timestampArray[0] * 1000).toISOString();
      }

      return {
        conversation_id: convId,
        source: 'gemini',
        updated_at: updated_at
      };
    }).filter(item => item.conversation_id); // Filter out invalid entries

    console.log(`[Gemini] Checking ${checkPayload.length} conversations with backend...`);
    showNotification(`Checking ${checkPayload.length} conversations...`, 'info');

    // Check with backend which conversations need syncing
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

    console.log(`[Gemini] Backend says ${needsSyncIds.size} conversations need syncing`);

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
    const conversationsToSync = conversations.filter(conv => {
      const convId = Array.isArray(conv) ? conv[0] : (conv.id || conv.conversation_id);
      return needsSyncIds.has(convId);
    });

    console.log(`[Gemini] Will sync ${conversationsToSync.length} conversations`);
    showNotification(`Syncing ${conversationsToSync.length} conversations...`, 'info');

    // Create persistent progress notification
    const progressNotification = document.createElement('div');
    progressNotification.id = 'gemini-sync-progress';
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
      const convId = Array.isArray(conv) ? conv[0] : (conv.id || conv.conversation_id);
      const convTitle = Array.isArray(conv) ? conv[1] : (conv.title || 'Untitled');

      progressNotification.textContent = `Quick sync ${i + 1}/${conversationsToSync.length}: ${convTitle}`;
      console.log(`[Gemini] Syncing ${i + 1}/${conversationsToSync.length}: ${convId} - "${convTitle}"`);

      try {
        // Fetch full conversation with messages
        const fullConversation = await fetchConversationMessages(convId);

        // Convert to our format
        const dbConversation = convertGeminiAPIToDBFormat(fullConversation, convId, convTitle);

        // Send to backend
        const response = await apiFetch('/api/import/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: [dbConversation] })
        });

        if (response.ok) {
          synced++;
          console.log(`[Gemini] ✓ Synced: ${dbConversation.title}`);
        } else {
          failed++;
          console.error(`[Gemini] ✗ Failed to save: ${dbConversation.title}`);
        }
      } catch (error) {
        failed++;
        console.error(`[Gemini] Error syncing ${convId}:`, error);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Remove progress notification
    progressNotification.remove();

    // NEW: Update sync state with newest conversation ID
    if (conversations.length > 0) {
      const newestConvId = Array.isArray(conversations[0]) ? conversations[0][0] : conversations[0].conversation_id;
      await setLastSyncedConversation(newestConvId, 'quick');
      console.log(`[Gemini] Updated last synced conversation: ${newestConvId}`);
    }

    // Show final result
    showNotification(`✓ Quick sync: ${synced}/${conversationsToSync.length} synced! (${failed} failed)`, 'success');
    console.log(`[Gemini] Quick sync complete: ${synced} synced, ${failed} failed out of ${conversationsToSync.length} needed`);

    chrome.runtime.sendMessage({
      action: 'syncComplete',
      service: SERVICE,
      result: { synced, failed, total: conversationsToSync.length }
    });

  } catch (error) {
    console.error('[Gemini] Quick sync FAILED with error:', error);
    console.error('[Gemini] Error stack:', error.stack);

    // Remove progress notification if it exists
    const progressNotification = document.getElementById('gemini-sync-progress');
    if (progressNotification) {
      progressNotification.remove();
    }

    showNotification('✗ Quick sync failed: ' + error.message, 'error');
    throw error;
  }
}

// Helper function to convert Gemini API response to DB format
function convertGeminiAPIToDBFormat(apiData, conversationId, title) {
  const messages = [];
  let oldestTimestamp = null;
  let newestTimestamp = null;

  // Parse messages from API response
  // NOTE: Structure needs to be adjusted based on actual API response
  // Look for message arrays in the response

  console.log('[Gemini] Converting API data to DB format:', apiData);

  // Gemini hNvQHb response structure varies:
  // Sometimes: [Array(2), null, null, Array(1)] - 2 messages
  // Sometimes: [Array(1), null, null, Array(0)] - 1 message visible, but might be nested
  let messageArray = null;

  if (Array.isArray(apiData)) {
    // Log each element to understand structure
    apiData.forEach((element, index) => {
      console.log(`[Gemini] apiData[${index}]:`, element, typeof element, Array.isArray(element) ? `length ${element.length}` : '');

      // If it's an array with 1 element, check if that element is also an array (nested structure)
      if (Array.isArray(element) && element.length === 1 && Array.isArray(element[0])) {
        console.log(`[Gemini]   → apiData[${index}][0] is nested:`, element[0]);
      }
    });

    // hNvQHb response structure: apiData[0] contains array of message exchanges
    // apiData[0] = [newest, ..., oldest] - exchanges are in reverse chronological order
    if (apiData.length >= 1 && Array.isArray(apiData[0]) && apiData[0].length >= 1) {
      console.log('[Gemini] Found', apiData[0].length, 'message exchange(s) in conversation');
      messageArray = [];

      // Loop through exchanges in REVERSE order to get chronological order (oldest first)
      for (let exchangeIndex = apiData[0].length - 1; exchangeIndex >= 0; exchangeIndex--) {
        const conversationData = apiData[0][exchangeIndex];
        console.log(`\n[Gemini] Processing exchange ${apiData[0].length - exchangeIndex}/${apiData[0].length}`);
        console.log('[Gemini] conversationData:', conversationData);

        if (!Array.isArray(conversationData) || conversationData.length < 4) {
          console.log('[Gemini] ⚠️ Invalid exchange structure, skipping');
          continue;
        }

        // Extract timestamp from conversationData[4]: [seconds, nanoseconds]
        if (Array.isArray(conversationData[4]) && conversationData[4].length >= 1) {
          const seconds = conversationData[4][0];
          const nanoseconds = conversationData[4][1] || 0;
          const timestamp = new Date(seconds * 1000 + nanoseconds / 1000000).toISOString();

          // Track oldest and newest timestamps
          if (!oldestTimestamp) oldestTimestamp = timestamp;
          newestTimestamp = timestamp; // Keep updating to get the last one
        }

        // conversationData[2] = user message container: [[text], 2, null, ...]
        // conversationData[3] = assistant message: [id, [text], ...]
        console.log('[Gemini] conversationData[2] (user message):', conversationData[2]);
        console.log('[Gemini] conversationData[3] (assistant message):', conversationData[3]);

        // Add user message - extract text from nested structure
        // Format: [[text], 2, null, 0, id, 0]
        if (conversationData[2]) {
          const userMsg = conversationData[2];
          // User message text is at userMsg[0][0]
          if (Array.isArray(userMsg) && Array.isArray(userMsg[0]) && userMsg[0][0]) {
            const userText = userMsg[0][0];
            const timestamp = conversationData[4]; // Timestamp might be here
            // Create a message object that matches our expected format
            messageArray.push({
              role: 'user',
              text: userText,
              timestamp: timestamp,
              raw: userMsg
            });
            console.log('[Gemini] ✓ Extracted user message:', userText.substring(0, 50));
          }
        }

        // Add assistant message - it's a single message object
        // Format: [Array(1), Array(14), null, id, ...]
        // The text might be in index 1
        if (conversationData[3]) {
          const assistantMsg = conversationData[3];

          // Log the full structure to understand it better
          console.log('[Gemini] Assistant message structure:');
          console.log('  assistantMsg[0]:', assistantMsg[0]);
          console.log('  assistantMsg[1]:', assistantMsg[1]);

          // Try to find the actual response text
          let assistantText = null;

          // Check assistantMsg[0] - might contain nested response
          if (Array.isArray(assistantMsg[0]) && assistantMsg[0].length > 0) {
            console.log('[Gemini] Checking assistantMsg[0][0]:', assistantMsg[0][0]);

            // Format might be: [["response_id", ["actual text", ...]]]
            if (Array.isArray(assistantMsg[0][0]) && assistantMsg[0][0].length >= 2) {
              const responseData = assistantMsg[0][0];
              console.log('[Gemini] Response data:', responseData);

              // Extract text from second element
              if (Array.isArray(responseData[1]) && responseData[1].length > 0) {
                assistantText = responseData[1][0];
                console.log('[Gemini] Found text in assistantMsg[0][0][1][0]:', typeof assistantText, assistantText?.substring(0, 100));
              }
            }
          }

          // Fallback: try assistantMsg[1][0] but it might be title/summary
          if (!assistantText && Array.isArray(assistantMsg[1]) && assistantMsg[1][0]) {
            let fallbackText = assistantMsg[1][0];
            if (Array.isArray(fallbackText)) {
              fallbackText = fallbackText[0];
            }
            if (typeof fallbackText === 'string' && fallbackText.trim()) {
              console.log('[Gemini] ⚠️ Using fallback text from assistantMsg[1][0] (might be title):', fallbackText.substring(0, 100));
              assistantText = fallbackText;
            }
          }

          // Ensure we have a string
          if (typeof assistantText === 'string' && assistantText.trim()) {
            const timestamp = conversationData[4];
            messageArray.push({
              role: 'assistant',
              text: assistantText,
              timestamp: timestamp,
              raw: assistantMsg
            });
            console.log('[Gemini] ✓ Extracted assistant message:', assistantText.substring(0, 50));
          } else {
            console.log('[Gemini] ⚠️ Could not extract assistant text');
          }
        }
      } // End of exchange loop

      console.log('[Gemini] Reconstructed', messageArray.length, 'messages from', apiData[0].length, 'exchange(s)');
    }

    // Fallback: old logic
    if (!messageArray) {
      for (let element of apiData) {
        if (Array.isArray(element) && element.length > 0) {
          // Check if element[0] is an array (messages)
          if (Array.isArray(element[0]) && element[0].length >= 5) {
            // This looks like messages
            console.log('[Gemini] Found messages array (fallback):', element);
            messageArray = element;
            break;
          }
        }
      }
    }
  } else if (apiData.messages) {
    messageArray = apiData.messages;
  } else if (apiData.conversation && apiData.conversation.messages) {
    messageArray = apiData.conversation.messages;
  }

  console.log('[Gemini] Using messageArray:', messageArray);
  console.log('[Gemini] messageArray length:', messageArray ? messageArray.length : 0);

  if (messageArray && Array.isArray(messageArray)) {
    messageArray.forEach((msg, index) => {
      if (!msg) {
        console.log(`[Gemini] Skipping null message at index ${index}`);
        return;
      }

      // Check if this is object format (from nested hNvQHb responses)
      if (msg.role && msg.text) {
        // Object format: {role, text, timestamp, raw}
        let timestamp = new Date().toISOString();

        // Handle timestamp conversion
        if (Array.isArray(msg.timestamp) && msg.timestamp.length >= 1) {
          const seconds = msg.timestamp[0];
          const nanoseconds = msg.timestamp[1] || 0;
          timestamp = new Date(seconds * 1000 + nanoseconds / 1000000).toISOString();
        } else if (typeof msg.timestamp === 'string') {
          timestamp = msg.timestamp;
        } else if (typeof msg.timestamp === 'number') {
          timestamp = new Date(msg.timestamp * 1000).toISOString();
        }

        console.log(`[Gemini] ✓ Extracted ${msg.role} message (object format): "${msg.text.substring(0, 50)}..."`);
        messages.push({
          role: msg.role,
          content: msg.text,
          timestamp: timestamp,
          sequence_number: index
        });
        return;
      }

      // Array format: [Array(2), Array(3)|null, Array(6), Array(22), Array(2)]
      // msg[1]: null = assistant message, Array = user message
      // msg[2][0]: The actual text content (string or array with text)
      // msg[4]: [timestamp_seconds, nanoseconds]

      if (!Array.isArray(msg) || msg.length < 5) {
        console.log(`[Gemini] Skipping invalid message structure at index ${index}`);
        return;
      }

      // Determine role: msg[1] is null for assistant, array for user
      const role = msg[1] === null ? 'assistant' : 'user';

      // Extract content from msg[2][0]
      let content = '';
      if (Array.isArray(msg[2]) && msg[2].length > 0) {
        const contentData = msg[2][0];
        if (typeof contentData === 'string') {
          content = contentData;
        } else if (Array.isArray(contentData) && contentData.length > 0) {
          content = contentData[0]; // Sometimes it's nested one more level
        }
      }

      // Extract timestamp from msg[4]
      let timestamp = new Date().toISOString();
      if (Array.isArray(msg[4]) && msg[4].length >= 1) {
        const seconds = msg[4][0];
        const nanoseconds = msg[4][1] || 0;
        timestamp = new Date(seconds * 1000 + nanoseconds / 1000000).toISOString();
      }

      if (content && typeof content === 'string') {
        console.log(`[Gemini] ✓ Extracted ${role} message (array format): "${content.substring(0, 50)}..."`);
        messages.push({
          role: role,
          content: content,
          timestamp: timestamp,
          sequence_number: index
        });
      } else {
        console.log(`[Gemini] ⚠️  Could not extract content from message ${index}:`, msg[2]);
      }
    });
  }

  // Use actual conversation timestamps, fallback to current time if not available
  const createdAt = oldestTimestamp || new Date().toISOString();
  const updatedAt = newestTimestamp || new Date().toISOString();

  console.log('[Gemini] Conversation timestamps - created:', createdAt, 'updated:', updatedAt);

  return {
    conversation_id: conversationId,
    title: title,
    source: 'gemini',
    created_at: createdAt,
    updated_at: updatedAt,
    messages: messages
  };
}

console.log('[Gemini] Content script loaded successfully!');
console.log('[Gemini] Ready to sync conversations');
