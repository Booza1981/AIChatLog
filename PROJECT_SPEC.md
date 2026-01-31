# Self-Hosted Chat History Search System - Project Specification

## PROJECT GOAL

Build a self-hosted alternative to Echoes that automatically scrapes and indexes conversations from Claude, ChatGPT, Gemini, and Perplexity. Uses a Chrome extension to extract conversation data from your real browser session and stores it in a local searchable database.

## IMPLEMENTATION APPROACH - CHROME EXTENSION

The system uses a **Chrome extension** running in your real browser to extract and sync conversation data. This approach solves all the challenges of browser automation, bot detection, and authentication management.

### Why Chrome Extension?

1. **No Bot Detection:** Runs in the user's real browser session with existing authentication
2. **Direct DOM/API Access:** Can extract conversation data directly from the page and intercept XHR requests
3. **No Authentication Issues:** Uses your existing logged-in session (no manual auth setup needed)
4. **Reliable:** Works immediately without complex browser automation or VNC setup
5. **Fast:** No Playwright/Selenium overhead, instant sync on demand
6. **Auto-Sync:** Background service worker can sync automatically every 2 hours

### Current Implementation Status

✅ **Claude** - Fully implemented with API-based sync (intercepts XHR requests)
✅ **Gemini** - Fully implemented with API-based sync (intercepts batchexecute API)
⏳ **ChatGPT** - Not yet implemented
⏳ **Perplexity** - Not yet implemented

### System Architecture

```
┌─────────────────────┐
│  Chrome Extension   │
│  (User's Browser)   │
│                     │
│  • Content Scripts  │
│  • XHR Interception │
│  • Auto-sync Timer  │
│  • Popup UI         │
└──────────┬──────────┘
           │ HTTP POST
           │ (localhost:8000)
           ▼
┌─────────────────────┐
│   FastAPI Backend   │
│   (Docker)          │
│                     │
│  • /api/import      │
│  • /api/search      │
│  • SQLite + FTS5    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Static Frontend   │
│   (nginx, Docker)   │
│                     │
│  • Search UI        │
│  • Dashboard        │
│  • Recent Chats     │
└─────────────────────┘
```

### How It Works

1. **User installs Chrome extension** (load unpacked in developer mode)
2. **User browses Claude/Gemini normally** - extension intercepts XHR/fetch requests in the background
3. **Manual or Auto Sync:**
   - Click "Sync Current" to sync the current conversation
   - Click "Sync All" to batch-sync all conversations
   - Auto-sync runs every 2 hours (configurable) on open tabs
4. **Extension captures conversation data:**
   - For Claude: Intercepts conversations API and organization data
   - For Gemini: Intercepts batchexecute API (MaZiqc for list, hNvQHb for messages)
   - Captures session tokens automatically (SNlM0e, "at" XSRF)
5. **Extension sends to backend:** POST to `http://localhost:8000/api/import/{service}`
6. **Backend stores data:** Upserts conversations into SQLite with FTS5 full-text search
7. **User searches:** Open http://localhost:3000 to search all conversations

### Service-Specific Implementation Details

**Claude (claude.ai):**
- **API Interception:** Intercepts `/api/organizations/{id}/chat_conversations`
- **Session Tokens:** Captured from cookies (session key)
- **Conversation Format:** JSON with uuid, name, created_at, updated_at, messages array
- **Message Structure:** Role (user/assistant), content, timestamps

**Gemini (gemini.google.com):**
- **API Interception:** Intercepts POST requests to `/_/BardChatUi/data/batchexecute`
- **RPC Methods:**
  - `MaZiqc` - List conversations with pagination (continuation tokens)
  - `hNvQHb` - Fetch individual conversation messages
- **Session Tokens:**
  - `SNlM0e` - Session token (from page source)
  - `at` - XSRF token (from cookies)
- **Conversation ID Format:** Stored without `c_` prefix, but API calls require `c_` prefix
- **Message Structure:** Complex nested arrays, parsed into role/content/timestamp

**ChatGPT (chat.openai.com):**
- Not yet implemented (Phase 4)

## PROJECT STRUCTURE

```
AIChatLog/
├── README.md
├── PROJECT_SPEC.md (this file)
├── TROUBLESHOOTING.md (common issues and solutions)
├── docker-compose.yml
│
├── chrome-extension/          # Browser extension
│   ├── manifest.json
│   ├── popup.html            # Extension UI
│   ├── popup.js
│   ├── background.js          # Auto-sync service worker
│   ├── auto-logger.js        # Console logging to backend
│   ├── content-scripts/
│   │   ├── claude-api.js     # Claude API client
│   │   ├── claude.js         # Claude content script
│   │   ├── gemini-api.js     # Gemini API client (batchexecute)
│   │   └── gemini.js         # Gemini content script
│   └── icons/
│
├── backend/                   # FastAPI server (Docker)
│   ├── Dockerfile
│   ├── main.py               # API endpoints
│   ├── database.py           # SQLite + FTS5 operations
│   ├── models.py             # Pydantic models
│   ├── requirements.txt
│
├── frontend/                  # Search dashboard (Docker)
│   ├── Dockerfile
│   ├── index.html            # Search interface
│   └── styles.css
│
├── scripts/                   # Maintenance scripts
│   ├── clear_gemini.py       # Clear Gemini conversations
│   ├── fix_gemini_duplicates.py  # Fix duplicate conversations
│   └── check_duplicates.py   # Check for duplicates
│
├── docs/
│   └── archived/             # Outdated Playwright/VNC docs
│
└── volumes/                   # Docker volumes (created at runtime)
    └── database/             # SQLite database file
```

## TECH STACK

- **Extension:** Chrome Extension (Manifest V3)
  - Content scripts injected in MAIN world (for XHR interception)
  - Background service worker for auto-sync scheduling
  - Chrome alarms API for periodic sync triggers
- **Backend:** Python 3.11+ with FastAPI
  - Async/await throughout
  - SQLite with FTS5 (external content tables)
  - Pydantic models for validation
  - CORS enabled for localhost extension communication
- **Frontend:** Vanilla JavaScript + HTML/CSS
  - Static files served by nginx
  - Simple search interface with filtering
- **Container:** Docker Compose
  - Backend: Python FastAPI container
  - Frontend: nginx container
  - Shared volume for database persistence

## DATABASE SCHEMA (CRITICAL - USE EXTERNAL CONTENT FTS5)

```sql
-- Primary conversations table
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL,
    title TEXT,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    last_message_at TIMESTAMP,
    message_count INTEGER DEFAULT 0,
    full_text TEXT  -- Concatenated messages for FTS
);

CREATE INDEX idx_conv_source ON conversations(source);
CREATE INDEX idx_conv_updated ON conversations(updated_at);

-- Messages table
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,  -- 'user' or 'assistant'
    content TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    sequence_number INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_msg_conv ON messages(conversation_id);
CREATE INDEX idx_msg_timestamp ON messages(timestamp);

-- FTS5 virtual table using external content
CREATE VIRTUAL TABLE conversations_fts USING fts5(
    title, 
    full_text,
    content='conversations',
    content_rowid='id'
);

-- Triggers to keep FTS synchronized
CREATE TRIGGER conversations_ai AFTER INSERT ON conversations BEGIN
    INSERT INTO conversations_fts(rowid, title, full_text)
    VALUES (new.id, new.title, new.full_text);
END;

CREATE TRIGGER conversations_ad AFTER DELETE ON conversations BEGIN
    DELETE FROM conversations_fts WHERE rowid = old.id;
END;

CREATE TRIGGER conversations_au AFTER UPDATE ON conversations BEGIN
    UPDATE conversations_fts 
    SET title = new.title, full_text = new.full_text
    WHERE rowid = new.id;
END;

-- Service status tracking
CREATE TABLE service_status (
    service TEXT PRIMARY KEY,
    last_sync_at TIMESTAMP,
    last_attempt_at TIMESTAMP,
    session_healthy BOOLEAN DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    last_error_message TEXT,
    consecutive_failures INTEGER DEFAULT 0,
    total_conversations_synced INTEGER DEFAULT 0,
    last_conversation_id TEXT
);
```

## DOCKER SETUP (CRITICAL CONFIGURATION)

### Dockerfile

```dockerfile
# Use official Playwright image with all dependencies pre-installed
FROM mcr.microsoft.com/playwright/python:v1.48-jammy

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install playwright browsers (already in base image, but ensure)
RUN playwright install chromium

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./volumes/browser-profiles:/app/volumes/browser-profiles
      - ./Database:/app/volumes/database
    environment:
      - SCRAPE_INTERVAL_HOURS=2
      - LOG_LEVEL=INFO
      - PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
    shm_size: '2gb'  # CRITICAL: Prevents Chromium crashes
    cap_add:
      - SYS_ADMIN  # May be needed for browser sandboxing
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Temporary VNC service for initial authentication setup
  # Remove after all services are authenticated
  vnc:
    image: dorowu/ubuntu-desktop-lxde-vnc:focal
    ports:
      - "5900:5900"  # VNC
      - "6080:80"    # noVNC web interface
    volumes:
      - ./volumes/browser-profiles:/app/volumes/browser-profiles
    environment:
      - VNC_PASSWORD=temppass123
    profiles:
      - setup  # Only run with: docker-compose --profile setup up

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  browser-profiles:
  database:
```

## CRITICAL TECHNICAL REQUIREMENTS

### 1. STREAMING RESPONSE HANDLER (ESSENTIAL FOR MODERN CHAT SERVICES)

Modern chat services use Server-Sent Events (SSE) or WebSockets for streaming responses. You MUST implement a buffer system to accumulate chunks.

```python
# stream_buffer.py
from typing import Dict, List
import json

class StreamBuffer:
    """
    Handles streaming responses from SSE/WebSocket connections.
    Accumulates chunks until completion marker detected.
    """
    def __init__(self):
        self.buffers: Dict[str, List[str]] = {}
    
    def add_chunk(self, conversation_id: str, chunk: str):
        """Add a chunk to the buffer for a conversation."""
        if conversation_id not in self.buffers:
            self.buffers[conversation_id] = []
        self.buffers[conversation_id].append(chunk)
    
    def is_complete(self, conversation_id: str, chunk: str) -> bool:
        """
        Check if stream is complete.
        ChatGPT uses: "data: [DONE]"
        Claude might use different markers - document per service
        """
        completion_markers = [
            "data: [DONE]",
            "[DONE]",
            "event: done"
        ]
        return any(marker in chunk for marker in completion_markers)
    
    def get_complete_message(self, conversation_id: str) -> str:
        """Reconstruct full message from chunks."""
        if conversation_id not in self.buffers:
            return ""
        
        chunks = self.buffers[conversation_id]
        # Parse SSE format: "data: {json}\n\n"
        messages = []
        for chunk in chunks:
            if chunk.startswith("data: ") and chunk != "data: [DONE]":
                try:
                    data = json.loads(chunk[6:])  # Remove "data: " prefix
                    # Extract message content (format varies by service)
                    messages.append(data)
                except json.JSONDecodeError:
                    continue
        
        self.buffers.pop(conversation_id)  # Clean up
        return messages
```

**Service-Specific Streaming Notes:**
- **ChatGPT:** Uses SSE with `data: {json}\n\n` format, ends with `data: [DONE]`
- **Claude:** Verify format (may use similar SSE or standard JSON)
- **Gemini:** Unknown - investigate during implementation
- **Perplexity:** Unknown - investigate during implementation

### 2. LEGACY PLAYWRIGHT PROTOTYPE (ASYNC WITH BROWSER CONTEXT)

```python
# extension/base.py
from abc import ABC, abstractmethod
from playwright.async_api import async_playwright, BrowserContext
import os

class BaseSyncPrototype(ABC):
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.profile_path = f"/app/volumes/browser-profiles/{service_name}"
        self.stream_buffer = StreamBuffer()
    
    async def get_browser_context(self) -> BrowserContext:
        """
        Load browser context from persistent profile.
        Maintains sessions across container restarts.
        """
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(
            headless=True,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox'
            ]
        )
        
        # Load persistent context (preserves cookies/sessions)
        context = await browser.new_context(
            storage_state=f"{self.profile_path}/state.json" if os.path.exists(f"{self.profile_path}/state.json") else None,
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080}
        )
        
        # Install stealth scripts
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined})
        """)
        
        return context
    
    async def save_session(self, context: BrowserContext):
        """Save session state for persistence."""
        os.makedirs(self.profile_path, exist_ok=True)
        await context.storage_state(path=f"{self.profile_path}/state.json")
    
    async def check_session_health(self) -> bool:
        """Test if session is still valid."""
        try:
            context = await self.get_browser_context()
            page = await context.new_page()
            
            # Navigate to service and check if logged in
            await page.goto(self.get_base_url())
            is_logged_in = await self.verify_logged_in(page)
            
            await context.close()
            return is_logged_in
        except Exception as e:
            print(f"Session health check failed: {e}")
            return False
    
    @abstractmethod
    def get_base_url(self) -> str:
        """Return base URL for the service."""
        pass
    
    @abstractmethod
    async def verify_logged_in(self, page) -> bool:
        """Check if user is logged in."""
        pass
    
    @abstractmethod
    async def scrape_conversations(self) -> List[dict]:
        """Main scraping logic - implement per service."""
        pass
```

### 3. API ENDPOINTS (USE BACKGROUND TASKS)

```python
# main.py
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse

app = FastAPI()

@app.post("/api/scrape/{service}")
async def trigger_scrape(service: str, background_tasks: BackgroundTasks):
    """
    Trigger scrape in background to avoid UI hanging.
    Returns immediately with status.
    """
    if service not in ["claude", "chatgpt", "gemini", "perplexity", "all"]:
        raise HTTPException(status_code=400, detail="Invalid service")
    
    background_tasks.add_task(run_sync, service)
    return {"status": "started", "service": service}

@app.get("/api/search")
async def search_conversations(
    q: str,
    source: str = None,
    date_from: str = None,
    date_to: str = None,
    limit: int = 20,
    offset: int = 0
):
    """
    Full-text search using FTS5.
    Returns matching conversations with highlighted snippets.
    """
    # Implementation using FTS5 external content table
    query = """
        SELECT c.*, snippet(conversations_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
        FROM conversations c
        JOIN conversations_fts ON conversations_fts.rowid = c.id
        WHERE conversations_fts MATCH ?
    """
    # Add filters for source, date range
    # Execute query
    # Return results
    pass

@app.get("/api/health")
async def health_check():
    """Check service and database health."""
    return {
        "status": "healthy",
        "database": "connected",
        "services": await get_service_statuses()
    }

@app.get("/api/stats")
async def get_stats():
    """Return statistics about stored conversations."""
    return {
        "total_conversations": await count_conversations(),
        "by_source": await count_by_source(),
        "date_range": await get_date_range(),
        "total_messages": await count_messages()
    }
```

## IMPLEMENTATION STATUS

### Completed (Phase 1-3)

✅ **Foundation & Backend:**
- Docker Compose setup with backend + frontend containers
- FastAPI backend with async/await
- SQLite database with FTS5 external content tables
- API endpoints: /api/import, /api/search, /api/stats, /api/health, /api/recent
- Full-text search with highlighting
- Frontend search interface with filtering

✅ **Chrome Extension:**
- Manifest V3 extension with content scripts
- Popup UI with service toggles
- Background service worker for auto-sync (every 2 hours, configurable)
- Console logging forwarded to backend (/api/auto-log)
- Manual sync buttons: "Sync Current", "Sync All"

✅ **Claude Integration:**
- XHR interception for conversations API
- Organization ID capture
- Conversation list and message extraction
- Automatic timestamp parsing
- Database upsert (no duplicates)

✅ **Gemini Integration:**
- XHR interception for batchexecute API
- Session token capture (SNlM0e, "at")
- Pagination with continuation tokens (MaZiqc RPC)
- Individual message fetching (hNvQHb RPC)
- Conversation ID normalization (storage without `c_` prefix, API calls with it)
- Database upsert with complex timestamp handling

### In Progress / Future

⏳ **ChatGPT Integration:**
- Identify API endpoints
- Implement content script
- Handle SSE streaming responses
- Test sync and storage

⏳ **Perplexity Integration:**
- Investigate API structure
- Implement content script

⏳ **Incremental Sync (Deferred):**
- Attempted in feature/quick-sync branch but rolled back due to complexity
- Check which conversations need updating before fetching full data
- Would require /api/conversations/check endpoint
- Needs proper stub conversation timestamp handling

⏳ **Performance Optimizations:**
- Batch API requests more efficiently
- Reduce redundant DOM queries
- Optimize database upserts

⏳ **UI Improvements:**
- Better error messaging in extension popup
- Sync progress indicators
- Dashboard enhancements (conversation view, export)

## CRITICAL CONSIDERATIONS

### Authentication (Solved by Extension Approach)

- **No authentication management needed** - extension uses your existing logged-in session
- **Sessions managed by browser** - as long as you're logged into Claude/Gemini, extension works
- **No bot detection issues** - running in real browser with real cookies
- **No 2FA complications** - extension works after you're already authenticated

### Error Handling

- Extension logs errors to browser console (F12 to debug)
- Backend logs all import errors with full context
- Each service syncs independently (Claude failure doesn't affect Gemini)
- UPSERT database operations prevent duplicates
- Failed syncs can be retried by clicking sync button again

### Security

- **Extension permissions**: Host permissions for claude.ai, gemini.google.com, chat.openai.com
- **Local only**: Backend runs on localhost:8000 (not exposed to internet)
- **Database**: Stored locally in Docker volume (not cloud synced)
- **CORS**: Backend allows requests from extension and frontend only
- **No API keys needed**: Extension doesn't need auth - uses your browser session

### Performance

- **Async operations** throughout backend (FastAPI + aiosqlite)
- **FTS5 external content tables** for fast full-text search
- **Indexed columns** for source, timestamps
- **XHR interception** is lightweight (runs in content script MAIN world)
- **Batch imports**: "Sync All" fetches all conversations then imports in one request

### Known Issues & Limitations

1. **Gemini Desktop App Conflict**: If Gemini desktop app is open, clicking "Open in Gemini" links may cause conflicts (investigation needed)
2. **First Page Missing**: Sometimes recent conversations don't sync on first attempt (requires "Sync All")
3. **Performance**: "Sync All" can take 30-60 seconds for services with 500+ conversations
4. **ChatGPT Not Implemented**: UI shows toggle but no content script yet
5. **No Conversation Deletion**: Once synced, conversations stay in database (no auto-cleanup)

### Legal/TOS Compliance

Add prominent disclaimer to README:

```markdown
## Legal Disclaimer

This tool is for **personal use only** to create a searchable archive of your own chat conversations.

- You are responsible for compliance with each service's Terms of Service
- This tool is not affiliated with or endorsed by Anthropic, OpenAI, Google, or Perplexity
- Use at your own risk and discretion
- Not intended for commercial use or redistribution
- Author assumes no liability for TOS violations or account actions

By using this tool, you acknowledge that you have read and understood the terms of service for each platform you scrape.
```

## GETTING STARTED

### Prerequisites

- Chrome browser (for extension)
- Docker and Docker Compose (for backend/frontend)
- Git (to clone repository)

### Setup Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Booza1981/AIChatLog.git
   cd AIChatLog
   ```

2. **Start backend and frontend:**
   ```bash
   docker-compose up -d
   ```
   - Backend: http://localhost:8000
   - Frontend: http://localhost:3000

3. **Install Chrome extension:**
   - Open `chrome://extensions` in Chrome
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `chrome-extension/` directory

4. **Sync conversations:**
   - Browse to claude.ai or gemini.google.com
   - Click the extension icon
   - Click "Sync All Conversations"
   - Wait for sync to complete (check console with F12)

5. **Search conversations:**
   - Open http://localhost:3000
   - Enter search query
   - Filter by service, date range

For troubleshooting, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

---

## ALTERNATIVE APPROACH: PLAYWRIGHT (NOT USED)

This project originally planned to use Playwright for browser automation. This approach was **abandoned** in favor of the Chrome extension due to:

**Challenges with Playwright:**
- ❌ Bot detection (Cloudflare, anti-automation measures)
- ❌ Complex authentication flows (2FA, email verification)
- ❌ Requires VNC for manual authentication steps
- ❌ Session management complexity across restarts
- ❌ Docker setup complexity (shm_size, profiles, etc.)
- ❌ Unreliable for services with strong anti-bot protection

**Why Chrome Extension Won:**
- ✅ No bot detection (runs in real browser)
- ✅ No authentication management (uses existing session)
- ✅ Direct API access (XHR interception)
- ✅ Simple setup (load unpacked extension)
- ✅ Reliable and fast

The legacy Playwright prototype is not used by the extension. Documentation about Playwright/VNC setup has been archived in `docs/archived/` for historical reference.

---

**For questions or issues, see the [GitHub Issues](https://github.com/Booza1981/AIChatLog/issues).**
