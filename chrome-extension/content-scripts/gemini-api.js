/**
 * Gemini API Client
 * Uses Gemini's internal batchexecute API to fetch conversations
 *
 * Discovered endpoints:
 * - List chats: rpcids=MaZiqc
 * - Get chat data: rpcids=hNvQHb
 */

const GEMINI_BATCHEXECUTE_URL = 'https://gemini.google.com/_/BardChatUi/data/batchexecute';

/**
 * Parse Google's batchexecute response format
 * Google responses have this format:
 * )]}'
 * <length>
 * [["wrb.fr", "rpcid", "data", ...]]
 */
function parseBatchExecuteResponse(text) {
  console.log('[Gemini API] Parsing response...');

  // Remove CSRF protection prefix
  let cleaned = text;
  if (text.startsWith(')]}\'\n')) {
    cleaned = text.substring(5);
  }

  // Remove the length line (first non-empty line after CSRF prefix)
  // Format is: "<number>\n<json>"
  const lines = cleaned.split('\n');
  let startIndex = 0;

  // Skip empty lines and the length line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      // Skip empty lines
      continue;
    } else if (/^\d+$/.test(line)) {
      // This is the length line, skip it
      startIndex = i + 1;
      console.log('[Gemini API] Removed length line:', line);
      break;
    } else {
      // Found the JSON, start from here
      startIndex = i;
      break;
    }
  }

  // Google sends responses in multiple separate JSON chunks like:
  // <length1>\n<json1>\n<length2>\n<json2>\n<length3>\n<json3>
  // Each chunk is a complete, independent JSON array
  // We need to parse each chunk separately and find the wrb.fr chunk

  let currentChunk = [];
  let chunks = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      continue; // Skip empty lines
    }
    if (/^\d+$/.test(line)) {
      // This is a length marker - save current chunk and start new one
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(''));
        currentChunk = [];
      }
      console.log('[Gemini API] Found chunk length:', line);
      continue;
    }
    // This is JSON data
    currentChunk.push(lines[i]);
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(''));
  }

  console.log('[Gemini API] Found', chunks.length, 'JSON chunks');

  // Parse each chunk and look for wrb.fr response
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    try {
      const parsed = JSON.parse(chunk);
      console.log('[Gemini API] Chunk', chunkIndex, ':', parsed);

      // Google's format is: [[["wrb.fr", "rpcid", "jsonStringData", ...], ...]]
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Iterate through response items
        for (let i = 0; i < parsed.length; i++) {
          const responseItem = parsed[i];
          console.log(`[Gemini API] Chunk ${chunkIndex} item ${i}:`, responseItem);

          if (Array.isArray(responseItem) && responseItem.length > 0) {
            // Each item is like: ["wrb.fr", "MaZiqc", "{json}", null, null]
            const [marker, rpcId, data, , , errorArray] = responseItem;
            console.log(`[Gemini API]   marker: "${marker}", rpcId: "${rpcId}"`);

            if (marker === 'wrb.fr' && rpcId) {
              // Check if data is null (empty result or end of pagination)
              if (data === null) {
                console.log('[Gemini API] Found wrb.fr with null data - likely end of results');
                if (errorArray) {
                  console.log('[Gemini API] Error array:', errorArray);
                }
                // Return empty result structure: [null, null, []]
                return [null, null, []];
              }

              if (data) {
                console.log('[Gemini API] Found wrb.fr response for:', rpcId);

                // Data might be a JSON string or already parsed
                if (typeof data === 'string') {
                  try {
                    const parsedData = JSON.parse(data);
                    console.log('[Gemini API] Parsed data:', parsedData);
                    return parsedData;
                  } catch (e) {
                    console.log('[Gemini API] Data is not JSON, returning as-is');
                    return data;
                  }
                }

                return data;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Gemini API] Failed to parse chunk', chunkIndex, ':', e.message);
      // Continue to next chunk
    }
  }

  // If no wrb.fr found, throw error
  console.error('[Gemini API] Could not find wrb.fr in any chunk. Full chunks:', chunks);
  throw new Error('No wrb.fr response found in any chunk');
}

// Store captured tokens (will be populated by events from gemini-xhr-interceptor.js in MAIN world)
let capturedSessionToken = null;
let capturedAtToken = null;

/**
 * Extract session token from page
 * Gemini uses SNlM0e token or similar for authentication
 */
function extractSessionToken() {
  console.log('[Gemini API] Extracting session token...');

  // Method 0: Use captured token if available
  if (capturedSessionToken) {
    console.log('[Gemini API] Using previously captured token from XHR');
    return capturedSessionToken;
  }

  // Method 0.5: Check if token was set via window.setGeminiToken (in MAIN world)
  // Note: We can't directly access MAIN world variables, but we get notified via events
  // This is just a fallback check

  // Method 1: Look for SNlM0e in page scripts
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const content = script.textContent;
    if (content.includes('SNlM0e')) {
      const match = content.match(/"SNlM0e":"([^"]+)"/);
      if (match) {
        console.log('[Gemini API] Found SNlM0e token:', match[1].substring(0, 50) + '...');
        return match[1];
      }
    }
  }

  // Method 2: Look for WIZ_global_data
  if (window.WIZ_global_data) {
    const wizData = window.WIZ_global_data;
    if (wizData.SNlM0e) {
      console.log('[Gemini API] Found token in WIZ_global_data');
      return wizData.SNlM0e;
    }
  }

  // Method 3: Check for data in page
  const dataScripts = document.querySelectorAll('script[nonce]');
  for (const script of dataScripts) {
    const content = script.textContent;
    // Look for patterns like: "token":"base64string"
    const patterns = [
      /"([A-Za-z0-9+\/]{500,})"/,  // Long base64-like strings
      /\["([A-Za-z0-9+\/]{500,})"\]/
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        console.log('[Gemini API] Found potential token via pattern match');
        return match[1];
      }
    }
  }

  console.warn('[Gemini API] Could not find session token');
  console.warn('[Gemini API] TIP: Click on a conversation in the sidebar to trigger an XHR request');
  console.warn('[Gemini API] The interceptor will capture the token automatically');
  return null;
}

// Listen for tokens captured by gemini-xhr-interceptor.js (runs in MAIN world at document_start)
window.addEventListener('geminiSessionTokenCaptured', (event) => {
  capturedSessionToken = event.detail;
  console.log('[Gemini API] ✓ Session token received from XHR interceptor:', capturedSessionToken.substring(0, 50) + '...');
});

window.addEventListener('geminiAtTokenCaptured', (event) => {
  capturedAtToken = event.detail;
  console.log('[Gemini API] ✓ "at" token received from XHR interceptor:', capturedAtToken);
});

// Listen for manually set token from page context (via gemini-token-helper.js in MAIN world)
window.addEventListener('geminiTokenSet', (event) => {
  capturedSessionToken = event.detail;
  console.log('[Gemini API] ✓ Token manually set from page context:', capturedSessionToken.substring(0, 50) + '...');
});

console.log('[Gemini API] Event listeners installed - waiting for tokens from MAIN world');

/**
 * Extract "at" token (XSRF protection token) from page
 */
function extractAtToken() {
  // Method 0: Use captured token from XHR interceptor
  if (capturedAtToken) {
    console.log('[Gemini API] Using captured "at" token from XHR:', capturedAtToken);
    return capturedAtToken;
  }

  // Look for "at" parameter in scripts
  // NOTE: The "at" token has format like "APwZiapXXX:1768210635981" (with colon)
  // Don't confuse it with "bl" which looks like "boq_assistant-bard-web-server_20260108.03_p1"
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const content = script.textContent;

    // Look for patterns - must have a colon to avoid matching "bl" parameter
    const patterns = [
      /"atValue":"(APwZia[^"]+:[^"]+)"/,
      /"at":"(APwZia[^"]+:[^"]+)"/,
      /\["at","(APwZia[^"]+:[^"]+)"\]/,
      /"cfb2h":"(APwZia[^"]+:[^"]+)"/
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1].includes(':')) {  // Ensure it has a colon
        console.log('[Gemini API] Found "at" token in script:', match[1]);
        return match[1];
      }
    }
  }

  console.warn('[Gemini API] Could not find "at" token - requests may fail');
  console.warn('[Gemini API] TIP: Scroll conversation list to trigger XHR and capture token automatically');
  return null;
}

/**
 * Get session parameters from page
 * These are needed for batchexecute calls
 */
function getSessionParams() {
  const url = new URL(window.location.href);

  const params = {
    'source-path': url.pathname,
    'hl': 'en-GB',
    'bl': 'boq_assistant-bard-web-server_20260108.03_p1', // May need updating
  };

  // Add "at" token if available
  const atToken = extractAtToken();
  if (atToken) {
    params['at'] = atToken;
  }

  return params;
}

/**
 * Normalize Gemini conversation ID by removing "c_" prefix if present
 * This ensures consistent ID format across DOM and API sources
 */
function normalizeConversationId(id) {
  if (!id) return id;
  return String(id).replace(/^c_/, '');
}

/**
 * Extract conversation IDs from DOM sidebar
 * This captures the most recent conversations that are visible
 * Note: Strips the "c_" prefix to match API format
 */
function extractConversationIDsFromDOM() {
  const conversationElements = document.querySelectorAll('[data-test-id="conversation"]');
  const conversationIDs = [];

  conversationElements.forEach(el => {
    // Extract from jslog attribute: jslog="...BardVeMetadataKey:[...["c_3911918e14353a6a"...
    const jslog = el.getAttribute('jslog');
    if (jslog) {
      const match = jslog.match(/"(c_[a-f0-9]+)"/);
      if (match) {
        // Strip "c_" prefix to normalize with API format
        const rawId = match[1].replace(/^c_/, '');
        conversationIDs.push(rawId);
      }
    }
  });

  console.log(`[Gemini API] Extracted ${conversationIDs.length} conversation IDs from DOM (normalized):`, conversationIDs.slice(0, 5));
  return conversationIDs;
}

/**
 * Fetch all conversations via Gemini batchexecute API
 * Uses rpcids=MaZiqc to get conversation list
 * Handles pagination to fetch all conversations
 * Also includes conversations visible in DOM sidebar
 */
async function fetchAllConversationsViaAPI() {
  console.log('[Gemini API] Fetching all conversations...');

  try {
    // First, get conversation IDs from DOM (most recent, visible ones)
    const domConversationIDs = extractConversationIDsFromDOM();

    // Extract session token from page
    const sessionToken = extractSessionToken();
    if (!sessionToken) {
      throw new Error('Could not extract session token from page. Try refreshing Gemini page.');
    }

    const params = getSessionParams();
    let allConversations = [];
    let continuationToken = null;
    let pageNum = 1;

    // Keep fetching pages until no more continuation token
    do {
      console.log(`[Gemini API] Fetching page ${pageNum}...`);

      // Build URL with parameters
      const url = new URL(GEMINI_BATCHEXECUTE_URL);
      url.searchParams.set('rpcids', 'MaZiqc');
      url.searchParams.set('source-path', params['source-path']);
      url.searchParams.set('hl', params['hl']);
      url.searchParams.set('bl', params['bl']);
      url.searchParams.set('_reqid', Math.floor(Math.random() * 1000000).toString());
      url.searchParams.set('rt', 'c');

      // Add "at" token if available (XSRF protection)
      if (params['at']) {
        url.searchParams.set('at', params['at']);
      }

      // Build proper request format: [[["MaZiqc","[20,\"SESSION_TOKEN\",[0,null,1]]",null,"generic"]]]
      // The continuationToken becomes the new sessionToken for the next page
      const currentSessionToken = continuationToken || sessionToken;
      const requestParams = JSON.stringify([20, currentSessionToken, [0, null, 1]]);
      const requestData = JSON.stringify([[["MaZiqc", requestParams, null, "generic"]]]);
      let body = `f.req=${encodeURIComponent(requestData)}`;

      // Add "at" token if available (as form parameter)
      if (params['at']) {
        body += `&at=${encodeURIComponent(params['at'])}`;
      }

      // Make request
      const response = await fetch(url.toString(), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: body
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Gemini API] Error response:', errorText);
        throw new Error(`API returned ${response.status}`);
      }

      const text = await response.text();
      const data = parseBatchExecuteResponse(text);

      // MaZiqc response format: [null, continuationToken, [conversations]]
      if (Array.isArray(data) && data.length >= 3) {
        const pageConversations = data[2];
        const nextToken = data[1];

        if (Array.isArray(pageConversations)) {
          console.log(`[Gemini API] Page ${pageNum}: Found ${pageConversations.length} conversations`);

          // Normalize conversation IDs in API results
          const normalizedConversations = pageConversations.map(conv => {
            if (Array.isArray(conv) && conv[0]) {
              const normalized = [...conv];
              normalized[0] = normalizeConversationId(conv[0]);
              return normalized;
            }
            return conv;
          });

          allConversations = allConversations.concat(normalizedConversations);
        }

        // Check for continuation token
        if (nextToken && typeof nextToken === 'string') {
          console.log(`[Gemini API] Found continuation token, fetching next page...`);
          continuationToken = nextToken;
          pageNum++;
        } else {
          console.log(`[Gemini API] No more pages`);
          continuationToken = null;
        }
      } else {
        console.warn('[Gemini API] Unexpected response format');
        continuationToken = null;
      }

    } while (continuationToken);

    console.log(`[Gemini API] Total conversations fetched: ${allConversations.length}`);

    // Verify that DOM conversations are included, fetch missing ones individually
    if (domConversationIDs.length > 0) {
      const fetchedIDs = allConversations.map(conv => conv[0]); // conversation ID is at index 0
      const missingIDs = domConversationIDs.filter(id => !fetchedIDs.includes(id));

      if (missingIDs.length > 0) {
        console.warn(`[Gemini API] ⚠️ ${missingIDs.length} visible conversations NOT found in API results:`, missingIDs);
        console.log(`[Gemini API] Fetching missing conversations individually...`);

        // Fetch each missing conversation by navigating to it and extracting from DOM
        for (const missingID of missingIDs) {
          try {
            // Create a stub conversation entry with the ID and title from DOM
            // Note: DOM has "c_" prefix, so add it back for DOM lookup
            const domElement = document.querySelector(`[jslog*="c_${missingID}"]`);
            if (domElement) {
              const titleElement = domElement.querySelector('.conversation-title');
              const title = titleElement ? titleElement.textContent.trim() : 'Untitled';

              // Create minimal conversation structure matching API format
              // Format: [id, title, null, null, [timestamp], ...]
              const stubConversation = [
                missingID,
                title,
                null,
                null,
                [Math.floor(Date.now() / 1000), 0], // Current timestamp as fallback
                null,
                null,
                null,
                null,
                null
              ];

              // Prepend to ensure recent conversations come first
              allConversations.unshift(stubConversation);
              console.log(`[Gemini API] ✓ Added missing conversation: ${missingID} - ${title}`);
            }
          } catch (err) {
            console.error(`[Gemini API] Failed to add missing conversation ${missingID}:`, err);
          }
        }

        console.log(`[Gemini API] ✓ Added ${missingIDs.length} missing conversations from DOM`);
      } else {
        console.log(`[Gemini API] ✓ All ${domConversationIDs.length} visible conversations are included in API results`);
      }
    }

    // Deduplicate conversations by ID to prevent any duplicates from being synced
    const seenIDs = new Set();
    const deduplicatedConversations = [];
    let duplicateCount = 0;

    for (const conv of allConversations) {
      const convId = Array.isArray(conv) ? normalizeConversationId(conv[0]) : null;
      if (convId) {
        if (seenIDs.has(convId)) {
          console.warn(`[Gemini API] ⚠️ Duplicate conversation ID detected and skipped: ${convId}`);
          duplicateCount++;
        } else {
          seenIDs.add(convId);
          // Ensure the conversation uses the normalized ID
          if (Array.isArray(conv)) {
            conv[0] = convId;
          }
          deduplicatedConversations.push(conv);
        }
      } else {
        console.warn(`[Gemini API] ⚠️ Conversation without ID, skipping:`, conv);
      }
    }

    if (duplicateCount > 0) {
      console.warn(`[Gemini API] ⚠️ Removed ${duplicateCount} duplicate conversations`);
    }
    console.log(`[Gemini API] Final conversation count after deduplication: ${deduplicatedConversations.length}`);

    // Return in same format as original: [null, null, [all conversations]]
    return [null, null, deduplicatedConversations];

  } catch (error) {
    console.error('[Gemini API] Error fetching conversations:', error);
    throw error;
  }
}

/**
 * Fetch a single conversation with all messages
 * Uses rpcids=hNvQHb to get conversation data
 *
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object>} Conversation data with messages
 */
async function fetchConversationMessages(conversationId) {
  console.log(`[Gemini API] Fetching conversation: ${conversationId}`);

  try {
    const params = getSessionParams();

    // Build URL
    const url = new URL(GEMINI_BATCHEXECUTE_URL);
    url.searchParams.set('rpcids', 'hNvQHb');
    url.searchParams.set('source-path', `/app/${conversationId}`);
    url.searchParams.set('hl', params['hl']);
    url.searchParams.set('bl', params['bl']);
    url.searchParams.set('_reqid', Math.floor(Math.random() * 1000000).toString());
    url.searchParams.set('rt', 'c');

    // Add "at" token if available (XSRF protection)
    if (params['at']) {
      url.searchParams.set('at', params['at']);
    }

    console.log('[Gemini API] Requesting conversation:', url.toString());

    // Build proper request format: [[["hNvQHb","[\"conversationId\",10,null,1,[1],[4],null,1]",null,"generic"]]]
    const requestParams = JSON.stringify([conversationId, 10, null, 1, [1], [4], null, 1]);
    const requestData = JSON.stringify([[["hNvQHb", requestParams, null, "generic"]]]);
    let body = `f.req=${encodeURIComponent(requestData)}`;

    // Add "at" token if available (as form parameter)
    if (params['at']) {
      body += `&at=${encodeURIComponent(params['at'])}`;
    }

    console.log('[Gemini API] Request body:', body.substring(0, 200) + '...');

    const response = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: body
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Gemini API] Error response:', errorText);
      throw new Error(`API returned ${response.status}`);
    }

    const text = await response.text();
    console.log('[Gemini API] Raw conversation response:', text.substring(0, 500));

    const data = parseBatchExecuteResponse(text);
    console.log('[Gemini API] Parsed conversation:', data);

    return data;

  } catch (error) {
    console.error(`[Gemini API] Error fetching conversation ${conversationId}:`, error);
    throw error;
  }
}

/**
 * Convert Gemini API format to our database format
 *
 * @param {Object} apiConversation - Raw API response
 * @returns {Object} Formatted conversation for database
 */
function convertGeminiAPIToDBFormat(apiConversation) {
  const messages = [];

  // TODO: Adjust based on actual API response structure
  // This is a placeholder - needs to be updated once we know the real format

  if (apiConversation.messages) {
    apiConversation.messages.forEach((msg, index) => {
      if (msg.role === 'user' || msg.author === 'user') {
        messages.push({
          role: 'user',
          content: msg.content || msg.text || '',
          timestamp: msg.timestamp || msg.created_at || new Date().toISOString(),
          sequence_number: index
        });
      } else if (msg.role === 'assistant' || msg.role === 'model' || msg.author === 'gemini') {
        messages.push({
          role: 'assistant',
          content: msg.content || msg.text || '',
          timestamp: msg.timestamp || msg.created_at || new Date().toISOString(),
          sequence_number: index
        });
      }
    });
  }

  return {
    conversation_id: apiConversation.id || apiConversation.conversation_id,
    title: apiConversation.title || apiConversation.name || 'Untitled',
    source: 'gemini',
    created_at: apiConversation.created_at || new Date().toISOString(),
    updated_at: apiConversation.updated_at || new Date().toISOString(),
    messages: messages
  };
}

/**
 * Debug: Log all network requests to find API endpoints
 *
 * Usage:
 * 1. Open gemini.google.com
 * 2. Open DevTools console
 * 3. Run: logGeminiNetworkRequests()
 * 4. Click through conversations in the UI
 * 5. Check console for API calls
 */
function logGeminiNetworkRequests() {
  console.log('[Gemini API Debug] Starting network request logger...');
  console.log('[Gemini API Debug] Now interact with Gemini (open conversations, etc)');
  console.log('[Gemini API Debug] Watch this console for API calls');

  // Override fetch to log all requests
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = args[0];
    console.log('[Gemini API Debug] FETCH:', url);
    return originalFetch.apply(this, args);
  };

  // Override XMLHttpRequest
  const originalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new originalXHR();
    const originalOpen = xhr.open;
    xhr.open = function(method, url) {
      console.log('[Gemini API Debug] XHR:', method, url);
      return originalOpen.apply(this, arguments);
    };
    return xhr;
  };

  console.log('[Gemini API Debug] ✓ Logger active!');
}

// Make available globally for debugging
window.logGeminiNetworkRequests = logGeminiNetworkRequests;
window.fetchAllGeminiConversations = fetchAllConversationsViaAPI;

console.log('[Gemini API] Client loaded');
console.log('[Gemini API] XHR interceptor is running in MAIN world and will capture tokens automatically');
console.log('[Gemini API] TIP: Scroll conversation list or click a conversation to trigger token capture');
