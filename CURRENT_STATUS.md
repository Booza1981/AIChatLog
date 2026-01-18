# Current Status - Chat History Search System

**Last Updated:** 2026-01-18

## 🎯 Current Implementation: Chrome Extension + API Sync

We **abandoned the Playwright approach** due to Cloudflare bot detection and switched to a **Chrome extension** that runs in the user's real browser. Playwright code and dependencies have been removed.

### ✅ What's Working

1. **Backend (FastAPI)**
   - ✅ SQLite database with FTS5 full-text search
   - ✅ `/api/import/claude` - Import conversations from extension
   - ✅ `/api/import/gemini` - Import Gemini conversations
   - ✅ `/api/search` - Full-text search across conversations
   - ✅ `/api/stats` - Statistics dashboard
   - ✅ `/api/conversations/{id}` - View full conversation as HTML
   - ✅ `/api/auto-log` - Console logging from extension (debugging)
   - ✅ Health check endpoint

2. **Frontend (Nginx)**
   - ✅ **Recent conversations on main page** - Shows 15 most recent chats in grid layout
   - ✅ **Dual link system** - Both "Open in Claude/Gemini" and "View Local" buttons
   - ✅ Search interface with prominent result links
   - ✅ View full conversations with formatting
   - ✅ Statistics dashboard showing conversation counts
   - ✅ Filter by service, date range
   - ✅ Responsive design (mobile-friendly)
   - ✅ Modern UI with hover effects and polish

3. **Chrome Extension - Claude Integration**
   - ✅ Loads in user's browser (no bot detection!)
   - ✅ **API-based sync** - Uses Claude's internal API endpoints
   - ✅ Syncs **ALL conversations** (not just visible in sidebar)
   - ✅ Progress notification with sync counter
   - ✅ Automatic console logging to backend for debugging
   - ✅ Single conversation sync ("Sync Current")
   - ✅ Full sync ("Sync All Conversations")
   - ✅ No page navigation needed - all via API calls

4. **Chrome Extension - ChatGPT Integration** ✨ NEW
   - ✅ **API-based sync** - Uses ChatGPT's backend-api endpoints
   - ✅ **Token interceptor** - Captures bearer token from fetch/XHR in MAIN world
   - ✅ **Full sync** - Syncs all conversations via `/backend-api/conversations`
   - ✅ **Quick sync** - Smart incremental sync (only new/updated)
   - ✅ **Custom headers** - oai-device-id, oai-language, oai-client-build-number
   - ✅ **Tree structure parsing** - Handles ChatGPT's message mapping format
   - ✅ **Supports chatgpt.com and chat.openai.com**

5. **Chrome Extension - Gemini Integration**
   - ✅ **API-based sync** - Uses Google's batchexecute API
   - ✅ **XHR interceptor** - Captures tokens in MAIN world at document_start
   - ✅ **Pagination working** - Syncs all conversations (hundreds+)
   - ✅ **Multi-chunk response parsing** - Handles Google's complex format
   - ✅ **Multiple message exchanges** - Full conversation history per chat
   - ✅ **Chronological order** - Messages in correct oldest-to-newest order
   - ✅ **Actual timestamps** - Uses conversation dates, not sync time
   - ✅ MaZiqc RPC (list conversations) + hNvQHb RPC (get conversation)
   - ✅ Continuation token pagination (token becomes next session token)

### ⚠️ Known Issues

1. **Perplexity Not Implemented**
   - Claude, ChatGPT, and Gemini are working
   - Need to find Perplexity API endpoints

2. **Gemini Login Does Not Persist in Chromium Container**
   - Google sign-in succeeds but profile never shows as signed in; Gemini cookies don’t survive redeploys
   - Cookies DB persists; issue appears specific to Google/Gemini
   - Tried: persistent `/config`, disable `ClearSiteDataOnExit` and `DeviceBoundSessionCredentials`, bind host `/etc/machine-id` + `/var/lib/dbus/machine-id`
   - Priority fix: stabilize Google session persistence in containerized Chromium

### ✅ Recently Fixed

1. **Extension Only Works When DevTools Open** - FIXED 2026-01-11
   - Issue: Popup lifecycle was closing before async operations completed
   - Solution: Moved all logic to background service worker
   - Details: See DEVTOOLS_BUG.md for full resolution

### 📊 Current Database Status

Check with:
```bash
docker exec chat-history-backend sqlite3 /app/volumes/database/conversations.db "SELECT COUNT(*) FROM conversations;"
```

The extension successfully syncs all available conversations from both Claude and Gemini.

## 🧭 Server Deployment Notes

- The `chromium` service runs a browser with the extension preloaded.
- Backend URL auto-detect prefers `http://backend:8000` inside Docker.
- If you rebuild/redeploy, reload the extension in `chrome://extensions` if it doesn’t update automatically.

## 🏗️ Architecture Overview

```
User Browser (Chrome)
  │
  ├─ Chrome Extension
  │   ├─ popup.html/popup.js         → UI for manual sync
  │   ├─ background.js               → Message forwarding
  │   ├─ content-scripts/
  │   │   ├─ claude-api.js           → API client for Claude
  │   │   └─ claude.js               → Main sync logic
  │   └─ auto-logger.js              → Console → Backend logging
  │
  ↓ (HTTP POST /api/import/claude)
  │
Docker Backend (localhost:8000)
  │
  ├─ FastAPI (main.py)
  ├─ SQLite + FTS5 (database.py)
  └─ Auto-log endpoint for debugging
  │
  ↓
Frontend (localhost:3000)
  └─ Search UI, view conversations
```

## 🔧 How API Sync Works

### Claude Sync

The extension uses Claude's internal API (discovered by inspecting network requests):

1. **Get Organization ID**
   ```javascript
   GET https://claude.ai/api/organizations
   → Returns: [{uuid: "org-id", ...}]
   ```

2. **Get ALL Conversations**
   ```javascript
   GET https://claude.ai/api/organizations/{orgId}/chat_conversations
   → Returns: Array of all conversations with metadata
   ```

3. **Get Full Conversation with Messages**
   ```javascript
   GET https://claude.ai/api/organizations/{orgId}/chat_conversations/{conversationId}
   → Returns: Full conversation with all messages
   ```

4. **Convert & Save**
   - Convert Claude's format to our database format
   - POST to `/api/import/claude`
   - Backend saves to SQLite

### ChatGPT Sync ✨ NEW

The extension uses ChatGPT's backend-api (requires bearer token):

1. **Capture Token via Fetch/XHR Interceptor**
   ```javascript
   // chatgpt-token-interceptor.js runs in MAIN world at document_start
   // Intercepts fetch and XHR to capture Authorization header
   // Stores token in hidden DOM element for content script access
   ```

2. **Get ALL Conversations**
   ```javascript
   GET https://chatgpt.com/backend-api/conversations?offset=0&limit=100&order=updated
   Headers: Authorization: Bearer {token}, oai-device-id, oai-language
   → Returns: { items: [...], total: N }
   → Paginate with offset until all fetched
   ```

3. **Get Full Conversation with Messages**
   ```javascript
   GET https://chatgpt.com/backend-api/conversation/{id}
   → Returns: { mapping: { msg-id: { message, parent, children } }, current_node }
   → Traverse tree from current_node back to root for message order
   ```

4. **Convert & Save**
   - Parse tree structure (mapping object with parent/child references)
   - Extract messages from content.parts array
   - Convert Unix timestamps to ISO format
   - POST to `/api/import/chatgpt`

### Gemini Sync

The extension uses Google's batchexecute API (more complex than Claude):

1. **Capture Tokens via XHR Interceptor**
   ```javascript
   // gemini-xhr-interceptor.js runs in MAIN world at document_start
   // Intercepts ALL XHR requests to capture:
   // - Session token (700+ char base64 string)
   // - "at" token (XSRF protection: APwZia...:timestamp)
   ```

2. **List ALL Conversations (MaZiqc RPC)**
   ```javascript
   POST https://gemini.google.com/_/BardChatUi/data/batchexecute
   f.req=[[["MaZiqc","[20,\"SESSION_TOKEN\",[0,null,1]]",null,"generic"]]]

   → Returns: [null, continuationToken, [20 conversations]]
   → Use continuationToken as new sessionToken for next page
   → Repeat until no more continuationToken
   ```

3. **Get Full Conversation (hNvQHb RPC)**
   ```javascript
   POST https://gemini.google.com/_/BardChatUi/data/batchexecute
   f.req=[[["hNvQHb","[\"conversationId\",10,null,1,[1],[4],null,1]",null,"generic"]]]

   → Returns: Complex nested structure with ALL message exchanges
   → Parse multi-chunk response format (Google's )]}'prefix + length lines)
   → Extract user/assistant messages from nested arrays
   ```

4. **Parse Complex Response Structure**
   ```javascript
   // Response format: )]}'<length>\n[JSON]<length>\n[JSON]...
   // Each exchange: [conversationData[0], null, userMsg, assistantMsg, timestamp]
   // User message: conversationData[2][0][0]
   // Assistant message: conversationData[3][0][0][1][0]
   // Process exchanges in reverse order for chronological sorting
   ```

5. **Convert & Save**
   - Convert Gemini's format to database format
   - Handle multiple exchanges per conversation
   - Use actual conversation timestamps
   - POST to `/api/import/gemini`

**Benefits:**
- ✅ Gets ALL conversations, not just visible in sidebar
- ✅ Automatic pagination with continuation tokens
- ✅ Full conversation history (all message exchanges)
- ✅ Proper chronological order
- ✅ Actual conversation dates
- ✅ No DOM parsing = more reliable
- ✅ No bot detection issues

## 🚀 Quick Start (Current State)

### 1. Start Backend
```bash
cd /home/booza/AIChatLog
docker-compose up -d
```

### 2. Install Chrome Extension
```bash
# Go to chrome://extensions/
# Enable "Developer mode"
# Click "Load unpacked"
# Select: /home/booza/AIChatLog/chrome-extension
```

### 3. Use Extension
1. Open https://claude.ai or https://gemini.google.com (log in normally)
2. Click extension icon in toolbar
3. Click "Sync All Conversations"
4. Watch blue notification with sync progress
5. Wait for completion (time depends on conversation count)

### 4. Search Your Conversations
Open http://localhost:3000 and search!

## 📝 File Locations

### Extension Files
- `/home/booza/AIChatLog/chrome-extension/`
  - `manifest.json` - Extension config
  - `popup.html` - UI
  - `popup.js` - Popup logic
  - `background.js` - Background service worker
  - `content-scripts/claude-api.js` - Claude API client
  - `content-scripts/claude.js` - Claude sync logic
  - `content-scripts/chatgpt-api.js` - ChatGPT API client **[NEW]**
  - `content-scripts/chatgpt.js` - ChatGPT sync logic **[NEW]**
  - `chatgpt-token-interceptor.js` - Token capture (MAIN world) **[NEW]**
  - `chatgpt-sync-state-manager.js` - Incremental sync state **[NEW]**
  - `content-scripts/gemini-api.js` - Gemini API client
  - `content-scripts/gemini.js` - Gemini sync logic
  - `auto-logger.js` - Console logging to backend

### Backend Files
- `/home/booza/AIChatLog/backend/`
  - `main.py` - FastAPI app with import endpoint
  - `database.py` - SQLite + FTS5
  - `models.py` - Pydantic models

### Frontend Files
- `/home/booza/AIChatLog/frontend/`
  - `index.html` - Search interface
  - `styles.css` - Styling

### Docker
- `/home/booza/AIChatLog/docker-compose.yml`
  - Backend: Port 8000
  - Frontend: Port 3000
  - **Volume mounted:** `./backend:/app` (for live code updates)

## 🐛 Debugging

### View Extension Console Logs in Backend
```bash
docker exec chat-history-backend cat /app/extension-console.log | tail -100
```

All `console.log()` from the extension is automatically sent here!

### Watch Logs Live
```bash
./watch-logs.sh
```

### Check Database
```bash
# Count conversations
docker exec chat-history-backend sqlite3 /app/volumes/database/conversations.db \
  "SELECT COUNT(*) FROM conversations;"

# See recent syncs
docker exec chat-history-backend sqlite3 /app/volumes/database/conversations.db \
  "SELECT title, source, created_at FROM conversations ORDER BY created_at DESC LIMIT 10;"
```

### Backend Logs
```bash
docker logs chat-history-backend --tail 100 -f
```

## ✨ Recent Improvements (2026-01-11)

### Frontend Overhaul
1. **Recent Conversations Display**
   - Main page now shows 15 most recent conversations
   - Responsive grid layout (3 columns desktop, 1 mobile)
   - Clickable cards with hover effects

2. **Dual Link System**
   - **"Open in Claude"** - Links directly to claude.ai/chat/{id}
   - **"View Local"** - Shows archived conversation in local database
   - Both options available on recent chats and search results
   - Supports Claude, ChatGPT, Gemini, Perplexity URLs

3. **UI/UX Polish**
   - Modern gradient buttons with icons
   - Smooth hover animations
   - Better visual hierarchy
   - Mobile-responsive design
   - "Back to Recent Chats" navigation

4. **Backend Endpoint**
   - `/api/recent` - Get most recent conversations (default 10, max 50)

## 🔜 Next Steps (For Next Chat)

### Priority 0: Gemini Login Persistence (Chromium Container)
- Determine why Google profile sign-in doesn’t attach or persist in container
- Validate cookie key stability and session behavior across redeploys
- Consider forcing keychain behavior or cookie policy for google/gemini domains

### Priority 1: Perplexity Support
- Find Perplexity API endpoints
- Implement API client in extension
- Test sync functionality

### Priority 2: Enhanced Search
- Add conversation tagging
- Filter by date ranges in UI
- Search within specific conversations

### Priority 3: Export Functionality
- Export conversations to markdown/JSON
- Backup/restore database

## 📚 Key Learnings

1. **Playwright approach failed** due to bot detection (Cloudflare)
2. **Chrome extension in real browser** bypasses all bot detection
3. **DOM scraping is fragile** - selectors break when UI changes
4. **API-based sync is superior**:
   - Faster (no page loads)
   - More reliable (no selectors)
   - Gets ALL data (not just visible)
   - Future-proof (APIs change less than UI)
5. **Development process improved significantly** with:
   - Auto-logging (console → backend)
   - Volume mounting (live code updates)
   - Better error messages

## 🎯 Success Metrics

- [x] Backend running and healthy
- [x] Frontend accessible and functional
- [x] Extension loads in Chrome
- [x] Single conversation sync works
- [x] API-based full sync implemented
- [x] Progress notifications working
- [x] Automatic debugging logs
- [x] **Full sync works without DevTools** ← FIXED!
- [x] **Claude full sync working** ← WORKING!
- [x] **ChatGPT full sync working** ← NEW!
- [x] **Gemini full sync working** ← WORKING!
- [x] **Smart incremental sync** ← NEW!
- [x] **Recent chats display on main page** ← DONE!
- [x] **External links to Claude.ai/ChatGPT/Gemini** ← DONE!
- [x] Search returns accurate results
- [ ] Perplexity support added

---

**For next chat:** System fully operational! Claude, ChatGPT, and Gemini all syncing perfectly. Smart incremental sync (Quick Sync) implemented for all services. Next priority: Add Perplexity support.
