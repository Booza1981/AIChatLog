# Gemini API Discovery Guide

We need to discover Gemini's internal API endpoints to implement "Sync All" functionality (like Claude has).

## Current Status

✅ **"Sync Current" works** - Extracts the currently open conversation from DOM (now with SVG noise filtered out)
⏳ **"Sync All" needs API** - Requires finding Gemini's conversation list endpoint

## How to Discover API Endpoints

### Method 1: Network Tab (Recommended)

1. **Open Gemini** in Chrome: https://gemini.google.com
2. **Open DevTools**: Press `F12` or `Ctrl+Shift+I`
3. **Go to Network tab**
4. **Clear existing logs**: Click the "🚫 Clear" button
5. **Filter for API calls**: In the filter box, type `api` or `json`
6. **Click on different conversations** in the sidebar
7. **Look for API calls** that fetch conversation data

**What to look for:**
- URLs containing `/api/`, `/conversations`, `/chats`, etc.
- JSON responses containing conversation lists or message data
- Headers showing authentication cookies/tokens

### Method 2: Using Built-in Logger

1. **Open Gemini** in Chrome
2. **Open DevTools Console**: Press `F12` → Console tab
3. **Run this command**:
   ```javascript
   window.logGeminiNetworkRequests()
   ```
4. **Interact with Gemini**: Click conversations, send messages, etc.
5. **Watch the console** for logged API calls
6. **Look for patterns** in the URLs

### Method 3: Inspect Gemini's JavaScript

1. Open DevTools → Sources tab
2. Look for bundled JavaScript files (often named like `main.js`, `app.js`, etc.)
3. Search for strings like:
   - `"/api/"`
   - `"conversations"`
   - `"fetch"`
   - `"chat"`
4. Find the API base URL and endpoints

## What We're Looking For

### 1. Conversation List Endpoint

Something like:
```
GET https://gemini.google.com/api/conversations
GET https://gemini.google.com/api/user/chats
GET https://aistudio.google.com/api/chats
```

Expected response:
```json
{
  "conversations": [
    {
      "id": "conv_123",
      "title": "My conversation",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### 2. Single Conversation Endpoint

Something like:
```
GET https://gemini.google.com/api/conversation/{id}
GET https://gemini.google.com/api/chat/{id}/messages
```

Expected response:
```json
{
  "id": "conv_123",
  "title": "My conversation",
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "timestamp": "..."
    },
    {
      "role": "assistant",
      "content": "Hi there!",
      "timestamp": "..."
    }
  ]
}
```

## Google's API Format

Google often uses a custom format called **batchexecute**:

```
POST https://gemini.google.com/_/BardChatUi/data/batchexecute
```

This is more complex - the request/response is encoded in a special format.

**If Gemini uses batchexecute:**
- Look at the request payload in Network tab
- Note the structure (usually starts with `[[["conversationId",...`)
- We'll need to reverse-engineer this format

## Once You Find the APIs

**Please report back with:**

1. **Conversation list endpoint**: Full URL
2. **Request method**: GET, POST, etc.
3. **Required headers**: Any special headers needed
4. **Response format**: Copy a sample JSON response
5. **Single conversation endpoint**: URL pattern (with `{id}` placeholder)
6. **Authentication**: Are cookies sufficient, or are there tokens?

## Alternative: Manual Testing

If you want to test right now:

1. **Reload the extension** in Chrome
2. **Open a Gemini conversation**
3. **Click extension → Sync Current**
4. **Check if SVG noise is gone** - should now have clean text only
5. **Verify in frontend**: `http://localhost:3000`

The SVG filtering is now implemented, so "Sync Current" should work cleanly!

## Next Steps

Once we discover the API:

1. Update `gemini-api.js` with real endpoints
2. Implement `fetchAllConversationsViaAPI()`
3. Implement `fetchConversationMessages()`
4. Add "Sync All" button handler for Gemini
5. Test syncing all conversations

---

**TL;DR:** Open Gemini → F12 → Network tab → Click around → Find API calls → Report back! 🔍
