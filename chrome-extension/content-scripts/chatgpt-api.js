/**
 * ChatGPT API Client
 * Uses ChatGPT's internal API to fetch conversations
 *
 * API Endpoints (discovered from HAR capture):
 * - GET /backend-api/conversations?offset=0&limit=28&order=updated&is_archived=false&is_starred=false - List conversations
 * - GET /backend-api/conversation/{id} - Get conversation with messages
 *
 * Authentication: Cookie-based (credentials: 'include')
 * Custom headers: oai-device-id, oai-language
 */

const CHATGPT_API_BASE = 'https://chatgpt.com/backend-api';

// Store device ID (consistent per session)
let deviceId = null;

// Helper to clean device ID - strip all quotes and whitespace
function cleanDeviceId(value) {
  if (!value) return null;
  // Remove leading/trailing whitespace, then strip any quotes (single or double)
  let cleaned = String(value).trim();
  // Try JSON.parse first in case it's a JSON string
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === 'string') {
      cleaned = parsed;
    }
  } catch (e) {
    // Not JSON, continue with string cleaning
  }
  // Remove any remaining quotes
  cleaned = cleaned.replace(/^["']+|["']+$/g, '');
  return cleaned;
}

// Generate or retrieve device ID - must match what ChatGPT uses
function getDeviceId() {
  // Always clean the cached value in case it has quotes from before
  if (deviceId) {
    deviceId = cleanDeviceId(deviceId);
    return deviceId;
  }

  // Method 1: Try to extract from page HTML (DeviceId in embedded JSON)
  try {
    const pageContent = document.documentElement.innerHTML;
    const patterns = [
      /"DeviceId"\s*:\s*"([a-f0-9-]{36})"/i,
      /"WebAnonymousCookieID"\s*:\s*"([a-f0-9-]{36})"/i,
      /"oai-did"\s*:\s*"([a-f0-9-]{36})"/i
    ];

    for (const pattern of patterns) {
      const match = pageContent.match(pattern);
      if (match) {
        deviceId = cleanDeviceId(match[1]);
        console.log('[ChatGPT API] Found device ID in page:', deviceId);
        return deviceId;
      }
    }
  } catch (e) {
    console.warn('[ChatGPT API] Failed to extract device ID from page:', e);
  }

  // Method 2: Try to get from localStorage (ChatGPT stores it there)
  try {
    // ChatGPT may store it under various keys
    const keys = ['oai-did', 'STATSIG_LOCAL_STORAGE_STABLE_ID'];
    for (const key of keys) {
      const stored = localStorage.getItem(key);
      if (stored) {
        deviceId = cleanDeviceId(stored);
        console.log('[ChatGPT API] Found device ID in localStorage:', deviceId);
        return deviceId;
      }
    }
  } catch (e) {
    console.warn('[ChatGPT API] localStorage not accessible');
  }

  // Method 3: Check cookies
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'oai-did' && value) {
        deviceId = cleanDeviceId(decodeURIComponent(value));
        console.log('[ChatGPT API] Found device ID in cookie:', deviceId);
        return deviceId;
      }
    }
  } catch (e) {
    console.warn('[ChatGPT API] Failed to check cookies');
  }

  // Fallback: Generate a new one (less ideal but necessary)
  deviceId = crypto.randomUUID();
  console.log('[ChatGPT API] Generated new device ID:', deviceId);
  return deviceId;
}

// Get build number from page (ChatGPT requires this header)
function getBuildNumber() {
  // Try to extract from page scripts or use a recent known value
  try {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent;
      // Look for buildId or similar patterns
      const match = content.match(/buildId["']?\s*[:=]\s*["']?(\d+)/);
      if (match) {
        return match[1];
      }
    }
  } catch (e) {
    // Ignore extraction errors
  }

  // Fallback to a recent known build number (from HAR capture)
  return '4195295';
}

/**
 * Make authenticated API request
 * ChatGPT uses cookie-based authentication with custom headers
 */
async function chatGPTFetch(endpoint, options = {}) {
  const deviceIdValue = getDeviceId();
  const buildNumber = getBuildNumber();

  // Debug: Log the raw values
  console.log('[ChatGPT API] Device ID value:', deviceIdValue, 'Type:', typeof deviceIdValue);
  console.log('[ChatGPT API] Build number:', buildNumber);

  const headers = {
    'Content-Type': 'application/json',
    'oai-device-id': deviceIdValue,
    'oai-language': 'en-US',
    'oai-client-build-number': buildNumber,
    ...options.headers
  };

  // Debug: Log the full headers object
  console.log('[ChatGPT API] Request headers:', JSON.stringify(headers, null, 2));

  const response = await fetch(`${CHATGPT_API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers
  });

  console.log('[ChatGPT API] Response status:', response.status);
  return response;
}

/**
 * Get all conversations via API
 * @param {Object} options - Filtering options
 * @param {number|null} options.maxLimit - Max conversations to return
 * @param {string|null} options.stopAtConversationId - Stop when this ID is found (for incremental sync)
 */
async function fetchAllConversationsViaAPI(options = {}) {
  const {
    maxLimit = null,
    stopAtConversationId = null
  } = options;

  console.log('[ChatGPT API] Fetching conversations...');
  if (maxLimit) console.log(`[ChatGPT API] Max limit: ${maxLimit}`);
  if (stopAtConversationId) console.log(`[ChatGPT API] Stop at conversation: ${stopAtConversationId}`);

  const allConversations = [];
  let offset = 0;
  const pageSize = 100;
  let hasMore = true;
  let foundStopId = false;

  while (hasMore && !foundStopId) {
    console.log(`[ChatGPT API] Fetching page at offset ${offset}...`);

    const response = await chatGPTFetch(`/conversations?offset=${offset}&limit=${pageSize}&order=updated&is_archived=false`);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Authentication failed. Please refresh the ChatGPT page and try again.');
      }
      throw new Error(`Failed to fetch conversations: ${response.status}`);
    }

    const data = await response.json();
    const conversations = data.items || [];

    console.log(`[ChatGPT API] Page returned ${conversations.length} conversations`);

    // Check for stop ID in this batch
    if (stopAtConversationId) {
      const stopIndex = conversations.findIndex(c => c.id === stopAtConversationId);
      if (stopIndex !== -1) {
        console.log(`[ChatGPT API] Found stop conversation at index ${stopIndex}`);
        allConversations.push(...conversations.slice(0, stopIndex));
        foundStopId = true;
        break;
      }
    }

    allConversations.push(...conversations);

    // Check if we've hit our limit
    if (maxLimit && allConversations.length >= maxLimit) {
      allConversations.length = maxLimit;
      console.log(`[ChatGPT API] Hit max limit of ${maxLimit}`);
      break;
    }

    // Check if there are more pages
    if (conversations.length < pageSize || (data.total && offset + pageSize >= data.total)) {
      hasMore = false;
    } else {
      offset += pageSize;
    }
  }

  console.log(`[ChatGPT API] Total conversations fetched: ${allConversations.length}`);
  return { conversations: allConversations };
}

/**
 * Get full conversation with messages via API
 */
async function fetchConversationMessages(conversationId) {
  console.log(`[ChatGPT API] Fetching conversation: ${conversationId}`);

  const response = await chatGPTFetch(`/conversation/${conversationId}`);

  if (!response.ok) {
    // Try to get error details from response body
    let errorDetail = '';
    try {
      const errorBody = await response.text();
      console.log(`[ChatGPT API] Error response body:`, errorBody);
      errorDetail = errorBody.substring(0, 200);
    } catch (e) {
      // Ignore
    }

    if (response.status === 404) {
      throw new Error(`Conversation ${conversationId} not found. ${errorDetail}`);
    }
    throw new Error(`Failed to fetch conversation ${conversationId}: ${response.status}. ${errorDetail}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Convert ChatGPT API format to our database format
 *
 * ChatGPT stores messages in a tree structure via 'mapping' object.
 * We need to traverse from root to current_node to get messages in order.
 */
function convertChatGPTAPIToDBFormat(apiConversation) {
  const messages = [];

  // ChatGPT uses a tree structure for messages
  // mapping: { "msg-id": { message: {...}, parent: "...", children: [...] } }
  const mapping = apiConversation.mapping || {};
  const currentNode = apiConversation.current_node;

  // Build message chain from current node back to root
  const messageChain = [];
  let nodeId = currentNode;

  while (nodeId && mapping[nodeId]) {
    const node = mapping[nodeId];
    if (node.message && node.message.content && node.message.author) {
      messageChain.unshift(node); // Add to beginning to maintain order
    }
    nodeId = node.parent;
  }

  // Convert each message
  messageChain.forEach((node, index) => {
    const msg = node.message;
    if (!msg) return;

    const role = msg.author?.role;

    // Skip system messages
    if (role === 'system') return;

    // Extract content - ChatGPT uses content.parts array
    let content = '';
    if (msg.content?.parts) {
      content = msg.content.parts
        .filter(part => typeof part === 'string')
        .join('\n');
    } else if (msg.content?.text) {
      content = msg.content.text;
    }

    // Skip empty messages
    if (!content.trim()) return;

    // Convert timestamp - ChatGPT uses Unix timestamp (seconds)
    let timestamp = new Date().toISOString();
    if (msg.create_time) {
      timestamp = new Date(msg.create_time * 1000).toISOString();
    }

    messages.push({
      role: role === 'user' ? 'user' : 'assistant',
      content: content,
      timestamp: timestamp,
      sequence_number: messages.length
    });
  });

  // Handle timestamps
  let createdAt = new Date().toISOString();
  let updatedAt = new Date().toISOString();

  if (apiConversation.create_time) {
    // create_time can be Unix timestamp (number) or ISO string
    if (typeof apiConversation.create_time === 'number') {
      createdAt = new Date(apiConversation.create_time * 1000).toISOString();
    } else {
      createdAt = apiConversation.create_time;
    }
  }

  if (apiConversation.update_time) {
    if (typeof apiConversation.update_time === 'number') {
      updatedAt = new Date(apiConversation.update_time * 1000).toISOString();
    } else {
      updatedAt = apiConversation.update_time;
    }
  }

  return {
    conversation_id: apiConversation.id || apiConversation.conversation_id,
    title: apiConversation.title || 'Untitled Conversation',
    source: 'chatgpt',
    created_at: createdAt,
    updated_at: updatedAt,
    messages: messages
  };
}

// Quick API test - lists first few conversations
async function testChatGPTAPI() {
  console.log('[ChatGPT API] Running API test...');

  try {
    // Test 1: Fetch regular conversations (not in projects)
    console.log('[ChatGPT API] Test 1: Fetching regular conversations...');
    const response = await chatGPTFetch('/conversations?offset=0&limit=5&order=updated');
    console.log('[ChatGPT API] Regular conversations status:', response.status);

    let regularConvs = [];
    if (response.ok) {
      const data = await response.json();
      regularConvs = data.items || [];
      console.log(`[ChatGPT API] Found ${regularConvs.length} regular conversations`);
    }

    // Test 2: Fetch projects (gizmos)
    console.log('[ChatGPT API] Test 2: Fetching projects...');
    const projectsResponse = await chatGPTFetch('/gizmos?limit=20');
    console.log('[ChatGPT API] Projects status:', projectsResponse.status);

    if (projectsResponse.ok) {
      const projectsData = await projectsResponse.json();
      console.log('[ChatGPT API] ===== PROJECTS RESPONSE =====');
      console.log(JSON.stringify(projectsData, null, 2));
    } else {
      // Try alternate endpoints for projects
      console.log('[ChatGPT API] Trying alternate project endpoints...');

      // Try /gizmos/discovery
      const discoveryResponse = await chatGPTFetch('/gizmos/discovery');
      console.log('[ChatGPT API] Discovery status:', discoveryResponse.status);
      if (discoveryResponse.ok) {
        const discoveryData = await discoveryResponse.json();
        console.log('[ChatGPT API] Discovery response:', JSON.stringify(discoveryData, null, 2));
      }

      // Try /me to get user info including projects
      const meResponse = await chatGPTFetch('/me');
      console.log('[ChatGPT API] /me status:', meResponse.status);
      if (meResponse.ok) {
        const meData = await meResponse.json();
        console.log('[ChatGPT API] /me response:', JSON.stringify(meData, null, 2));
      }
    }

    // Test 3: Try to get project conversations from current URL
    const projectMatch = window.location.pathname.match(/\/g\/(g-p-[a-zA-Z0-9]+)/);
    if (projectMatch) {
      const projectId = projectMatch[1];
      console.log(`[ChatGPT API] Test 3: Found project in URL: ${projectId}`);

      const projectConvsResponse = await chatGPTFetch(`/gizmos/${projectId}/conversations?cursor=0`);
      console.log('[ChatGPT API] Project conversations status:', projectConvsResponse.status);

      if (projectConvsResponse.ok) {
        const projectConvs = await projectConvsResponse.json();
        console.log('[ChatGPT API] ===== PROJECT CONVERSATIONS =====');
        console.log(JSON.stringify(projectConvs, null, 2));
      }
    }

    return { success: true, regularConversations: regularConvs.length };
  } catch (error) {
    console.error('[ChatGPT API] Test failed:', error);
    return { success: false, error: error.message };
  }
}

// Export for debugging
window.fetchAllChatGPTConversations = fetchAllConversationsViaAPI;
window.fetchChatGPTConversation = fetchConversationMessages;
window.testChatGPTAPI = testChatGPTAPI;

console.log('[ChatGPT API] Client loaded');

// Auto-run test after a short delay
setTimeout(async () => {
  console.log('[ChatGPT API] ===== AUTO-RUNNING API TEST =====');
  const result = await testChatGPTAPI();
  console.log('[ChatGPT API] ===== TEST RESULT =====', result);
}, 3000);
