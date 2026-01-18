/**
 * Claude API Client
 * Uses Claude's internal API to fetch conversations (much faster than DOM scraping)
 */

const CLAUDE_API_BASE = 'https://claude.ai/api';

/**
 * Get all conversations via API (no page loading needed!)
 * @param {Object} options - Filtering options
 * @param {number|null} options.maxLimit - Max conversations to return
 * @param {string|null} options.stopAtConversationId - Stop when this ID is found (for incremental sync)
 */
async function fetchAllConversationsViaAPI(options = {}) {
  const {
    maxLimit = null,
    stopAtConversationId = null
  } = options;

  console.log('[Claude API] Fetching organizations...');
  if (maxLimit) console.log(`[Claude API] Max limit: ${maxLimit}`);
  if (stopAtConversationId) console.log(`[Claude API] Stop at conversation: ${stopAtConversationId}`);

  // Get organization
  const orgsResponse = await fetch(`${CLAUDE_API_BASE}/organizations`, {
    credentials: 'include'
  });

  if (!orgsResponse.ok) {
    throw new Error(`Failed to fetch organizations: ${orgsResponse.status}`);
  }

  const orgs = await orgsResponse.json();
  console.log(`[Claude API] Found ${orgs.length} organizations`);

  if (orgs.length === 0) {
    throw new Error('No organizations found');
  }

  const orgId = orgs[0].uuid;
  console.log(`[Claude API] Using organization: ${orgId}`);

  // Get all conversations
  const convsResponse = await fetch(`${CLAUDE_API_BASE}/organizations/${orgId}/chat_conversations`, {
    credentials: 'include'
  });

  if (!convsResponse.ok) {
    throw new Error(`Failed to fetch conversations: ${convsResponse.status}`);
  }

  let conversations = await convsResponse.json();
  console.log(`[Claude API] ✓ Found ${conversations.length} total conversations via API`);

  // Apply smart filtering for incremental sync
  let filteredConversations = conversations;

  // If we have a stop ID, slice at that point (conversations before it are already synced)
  if (stopAtConversationId) {
    const stopIndex = conversations.findIndex(c => c.uuid === stopAtConversationId);
    if (stopIndex !== -1) {
      filteredConversations = conversations.slice(0, stopIndex);
      console.log(`[Claude API] Stopped at known conversation, returning ${filteredConversations.length} new conversations`);
    } else {
      console.log(`[Claude API] Stop conversation not found in list, returning all`);
    }
  }

  // Apply max limit
  if (maxLimit && filteredConversations.length > maxLimit) {
    filteredConversations = filteredConversations.slice(0, maxLimit);
    console.log(`[Claude API] Limited to ${maxLimit} conversations`);
  }

  console.log(`[Claude API] Returning ${filteredConversations.length} conversations after filtering`);
  return { orgId, conversations: filteredConversations };
}

/**
 * Get full conversation with messages via API
 */
async function fetchConversationMessages(orgId, conversationId) {
  const response = await fetch(
    `${CLAUDE_API_BASE}/organizations/${orgId}/chat_conversations/${conversationId}`,
    { credentials: 'include' }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch conversation ${conversationId}: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Convert Claude API format to our database format
 */
function convertClaudeAPIToDBFormat(apiConversation) {
  const messages = [];

  // Claude API returns chat_messages array
  if (apiConversation.chat_messages) {
    apiConversation.chat_messages.forEach((msg, index) => {
      const { text, thinking } = extractClaudeMessageContent(msg);

      // Human messages
      if (msg.sender === 'human') {
        messages.push({
          role: 'user',
          content: text || '',
          timestamp: msg.created_at || new Date().toISOString(),
          sequence_number: index
        });
      }
      // Assistant messages
      else if (msg.sender === 'assistant') {
        messages.push({
          role: 'assistant',
          content: text || '',
          thinking: thinking || undefined,
          timestamp: msg.created_at || new Date().toISOString(),
          sequence_number: index
        });
      }
    });
  }

  return {
    conversation_id: apiConversation.uuid,
    title: apiConversation.name || 'Untitled Conversation',
    source: 'claude',
    created_at: apiConversation.created_at || new Date().toISOString(),
    updated_at: apiConversation.updated_at || new Date().toISOString(),
    messages: messages
  };
}

function extractClaudeMessageContent(msg) {
  const textParts = [];
  const thinkingParts = [];

  if (Array.isArray(msg.content)) {
    msg.content.forEach((part) => {
      if (part.type === 'thinking' && part.thinking) {
        thinkingParts.push(part.thinking);
        return;
      }

      if (part.text) {
        textParts.push(part.text);
      }
    });
  }

  if (msg.text) {
    textParts.push(msg.text);
  }

  return {
    text: textParts.join('\n').trim(),
    thinking: thinkingParts.join('\n').trim()
  };
}
