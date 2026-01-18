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

  // Method 1: Try to extract from page HTML
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
        return deviceId;
      }
    }
  } catch (e) { /* ignore */ }

  // Method 2: Try localStorage
  try {
    const keys = ['oai-did', 'STATSIG_LOCAL_STORAGE_STABLE_ID'];
    for (const key of keys) {
      const stored = localStorage.getItem(key);
      if (stored) {
        deviceId = cleanDeviceId(stored);
        return deviceId;
      }
    }
  } catch (e) { /* ignore */ }

  // Method 3: Check cookies
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'oai-did' && value) {
        deviceId = cleanDeviceId(decodeURIComponent(value));
        return deviceId;
      }
    }
  } catch (e) { /* ignore */ }

  // Fallback: Generate a new one
  deviceId = crypto.randomUUID();
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

// Get access token from DOM element (set by token interceptor in MAIN world)
function getAccessToken() {
  try {
    const tokenEl = document.getElementById('__chatgpt_token__');
    if (tokenEl && tokenEl.textContent) {
      const token = tokenEl.textContent.trim();
      if (token.length > 50) return token;
    }
  } catch (e) {
    // Token not available
  }
  return null;
}

/**
 * Make authenticated API request
 * ChatGPT uses cookie-based authentication with custom headers
 * Some endpoints also require a bearer token
 */
async function chatGPTFetch(endpoint, options = {}) {
  const deviceIdValue = getDeviceId();
  const buildNumber = getBuildNumber();
  const accessToken = getAccessToken();

  const headers = {
    'Content-Type': 'application/json',
    'oai-device-id': deviceIdValue,
    'oai-language': 'en-US',
    'oai-client-build-number': buildNumber,
    'oai-client-version': 'prod',
    ...options.headers
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${CHATGPT_API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers
  });

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


  const allConversations = [];
  let offset = 0;
  const pageSize = 100;
  let hasMore = true;
  let foundStopId = false;

  while (hasMore && !foundStopId) {
    const response = await chatGPTFetch(`/conversations?offset=${offset}&limit=${pageSize}&order=updated&is_archived=false`);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Authentication failed. Please refresh the ChatGPT page and try again.');
      }
      throw new Error(`Failed to fetch conversations: ${response.status}`);
    }

    const data = await response.json();
    const conversations = data.items || [];

    // Check for stop ID in this batch
    if (stopAtConversationId) {
      const stopIndex = conversations.findIndex(c => c.id === stopAtConversationId);
      if (stopIndex !== -1) {
        allConversations.push(...conversations.slice(0, stopIndex));
        foundStopId = true;
        break;
      }
    }

    allConversations.push(...conversations);

    // Check if we've hit our limit
    if (maxLimit && allConversations.length >= maxLimit) {
      allConversations.length = maxLimit;
      break;
    }

    // Check if there are more pages
    if (conversations.length < pageSize || (data.total && offset + pageSize >= data.total)) {
      hasMore = false;
    } else {
      offset += pageSize;
    }
  }

  return { conversations: allConversations };
}

/**
 * Get full conversation with messages via API
 */
async function fetchConversationMessages(conversationId) {
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

// Quick API test - returns summary only
async function testChatGPTAPI() {
  try {
    // Test 1: Try basic conversations endpoint
    const convResponse = await chatGPTFetch('/conversations?offset=0&limit=10&order=updated');
    const convData = await convResponse.json();

    if (convResponse.ok && convData.items && convData.items.length > 0) {
      return { success: true, totalConversations: convData.items.length, endpoint: 'conversations' };
    }

    // Test 2: Try project conversations (from user's working curl)
    // First get user's gizmos
    const bootstrapResponse = await chatGPTFetch('/gizmos/bootstrap?limit=10');
    if (bootstrapResponse.ok) {
      const bootstrapData = await bootstrapResponse.json();
      let totalConvs = 0;

      // Try to get conversations from each gizmo
      if (bootstrapData.gizmos) {
        for (const gizmo of bootstrapData.gizmos.slice(0, 3)) {
          const gizmoConvResponse = await chatGPTFetch(`/gizmos/${gizmo.id}/conversations?cursor=0`);
          if (gizmoConvResponse.ok) {
            const gizmoConvData = await gizmoConvResponse.json();
            totalConvs += gizmoConvData.items?.length || gizmoConvData.conversations?.length || 0;
          }
        }
      }

      if (totalConvs > 0) {
        return { success: true, totalConversations: totalConvs, endpoint: 'gizmos' };
      }
    }

    return { success: false, error: `No conversations found`, status: convResponse.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Export for debugging
window.fetchAllChatGPTConversations = fetchAllConversationsViaAPI;
window.fetchChatGPTConversation = fetchConversationMessages;
window.testChatGPTAPI = testChatGPTAPI;
