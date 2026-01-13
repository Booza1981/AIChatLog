# Extension Debugging Guide

## Step 1: Check Console Logs

1. Open **claude.ai** in Chrome
2. Press **F12** to open DevTools
3. Go to **Console** tab
4. Click extension icon → "Sync Now"
5. Look for `[Claude]` messages

## What to look for:

### Good output (working):
```
[Claude] Starting conversation sync...
[Claude] Found 15 conversation links in sidebar
[Claude] Current URL: /chat/abc123-def456
[Claude] Extracting currently open conversation...
[Claude] Successfully extracted 1 conversation: "My Chat Title"
[Claude] Sync complete: {imported: 1}
```

### Bad output (error):
```
[Claude] Starting conversation sync...
[Claude] Found 0 conversation links in sidebar
[Claude] Current URL: /
[Claude] Not on a specific chat page. Navigate to a conversation first.
Error: No conversations found...
```

## Step 2: Check Your URL

The extension **only works** when you're viewing a specific conversation.

### ✅ Correct URLs:
- `https://claude.ai/chat/abc123-def456-...`
- `https://claude.ai/chat/anything-here`

### ❌ Wrong URLs:
- `https://claude.ai/` (main page)
- `https://claude.ai/chats` (conversation list)
- `https://claude.ai/settings` (settings page)

## Step 3: Make Sure You Have Conversations

1. Check if you can see conversations in the left sidebar
2. Click on any conversation to open it
3. Wait for messages to load
4. Then try "Sync Now" again

## Step 4: Check for Errors

In the Console tab, look for:
- Red error messages
- Failed network requests
- JavaScript errors

## Common Issues:

### Issue 1: "Not on Claude chat page"
**Fix**: Make sure you're on claude.ai, not chat.anthropic.com or another domain

### Issue 2: "No conversations found"
**Fix**: Make sure URL is `/chat/something`, not just `/`

### Issue 3: "Failed to fetch"
**Fix**: Backend not running. Run: `docker-compose up -d backend`

### Issue 4: Empty conversation
The extension found the conversation but couldn't extract messages.
This means the DOM selectors need updating.

## Step 5: Manual Test

Try this in the Console tab while on a Claude conversation page:

```javascript
// Test if conversation exists
console.log('URL:', window.location.pathname);
console.log('Conversation ID:', window.location.pathname.split('/chat/')[1]);

// Test if sidebar has conversations
console.log('Sidebar links:', document.querySelectorAll('a[href^="/chat/"]').length);

// Test if messages exist
console.log('Message containers:', document.querySelectorAll('[role="article"]').length);

// Test if title exists
console.log('Page title:', document.querySelector('h1')?.textContent);
```

Copy the output and send it to me!

## Step 6: Check Backend

Make sure backend is running:
```bash
curl http://localhost:8000/api/health
```

Should return: `{"status":"healthy",...}`

## Next Steps

Send me:
1. The console output from Step 5
2. Your current URL when you click "Sync Now"
3. Any error messages from the Console
