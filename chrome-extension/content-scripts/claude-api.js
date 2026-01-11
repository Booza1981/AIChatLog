/**
 * Claude API Client
 * Uses Claude's internal API to fetch conversations (much faster than DOM scraping)
 */

const CLAUDE_API_BASE = 'https://claude.ai/api';

/**
 * Get all conversations via API (no page loading needed!)
 */
async function fetchAllConversationsViaAPI() {
  console.log('[Claude API] Fetching organizations...');

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

  const conversations = await convsResponse.json();
  console.log(`[Claude API] ✓ Found ${conversations.length} conversations via API!`);

  return { orgId, conversations };
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
      // Human messages
      if (msg.sender === 'human') {
        messages.push({
          role: 'user',
          content: msg.text || '',
          timestamp: msg.created_at || new Date().toISOString(),
          sequence_number: index
        });
      }
      // Assistant messages
      else if (msg.sender === 'assistant') {
        // Content is in msg.content array
        const content = msg.content
          ? msg.content.map(c => c.text || '').join('\n')
          : (msg.text || '');

        messages.push({
          role: 'assistant',
          content: content,
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
