# Self-Hosted Chat History Search System - Project Specification

## PROJECT GOAL

Build a self-hosted alternative to Echoes that automatically scrapes and indexes conversations from Claude, ChatGPT, Gemini, and Perplexity. Must run in Docker with persistent storage, handle streaming responses, and maintain authenticated sessions across restarts.

## ARCHITECTURE

```
chat-history-search/
├── README.md (setup instructions + legal disclaimer)
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── main.py (FastAPI app)
│   ├── database.py (SQLite + FTS5 setup with external content tables)
│   ├── models.py (SQLAlchemy/Tortoise-ORM models)
│   ├── scheduler.py (APScheduler for periodic scraping)
│   ├── scraper.py (Playwright scraper orchestrator)
│   ├── stream_buffer.py (Handle SSE/WebSocket streaming)
│   ├── scrapers/
│   │   ├── base.py (abstract base scraper with common logic)
│   │   ├── claude.py
│   │   ├── chatgpt.py
│   │   ├── gemini.py
│   │   └── perplexity.py
│   ├── importers/
│   │   ├── claude_export.py (import from official exports)
│   │   ├── chatgpt_export.py
│   │   └── gemini_export.py
│   ├── search.py (FTS5 search logic)
│   ├── auth.py (session management and health checks)
│   └── requirements.txt
├── frontend/
│   ├── Dockerfile (nginx)
│   ├── index.html (search interface)
│   ├── dashboard.html (monitoring dashboard)
│   ├── app.js
│   └── styles.css
└── volumes/
    ├── browser-profiles/ (persistent Playwright sessions)
    └── database/ (SQLite database)
```

## TECH STACK

- **Backend:** Python 3.11+
- **Framework:** FastAPI (with async/await throughout)
- **Database:** SQLite with FTS5 (external content tables for performance)
- **ORM:** SQLAlchemy 2.0+ or Tortoise-ORM (async support)
- **Browser Automation:** Playwright with playwright-stealth
- **Scheduling:** APScheduler for periodic tasks
- **Frontend:** Vanilla JavaScript or htmx (keep it simple)
- **Container:** Docker Compose with proper Playwright base image

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

-- Scraper status tracking
CREATE TABLE scraper_status (
    service TEXT PRIMARY KEY,
    last_successful_scrape TIMESTAMP,
    last_attempt TIMESTAMP,
    session_healthy BOOLEAN DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    last_error_message TEXT,
    consecutive_failures INTEGER DEFAULT 0
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
      - ./volumes/database:/app/volumes/database
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

### 2. BASE SCRAPER CLASS (ASYNC WITH BROWSER CONTEXT)

```python
# scrapers/base.py
from abc import ABC, abstractmethod
from playwright.async_api import async_playwright, BrowserContext
import os

class BaseScraper(ABC):
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
    
    background_tasks.add_task(run_scraper, service)
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
        "services": await get_scraper_statuses()
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

## IMPLEMENTATION PHASES

### PHASE 0 - INFRASTRUCTURE VALIDATION (DO THIS FIRST - CRITICAL)

Before writing any scraper code, validate the Docker/Playwright setup:

1. **Create Minimal Test Environment:**
   - Build Dockerfile with Playwright base image
   - Add shm_size to docker-compose
   - Write simple test script:
   ```python
   # test_playwright.py
   from playwright.sync_api import sync_playwright
   
   with sync_playwright() as p:
       browser = p.chromium.launch(headless=True)
       page = browser.new_page()
       page.goto('https://example.com')
       print(page.title())
       browser.close()
   ```
   - Run in container and verify no crashes

2. **VNC Setup for Initial Authentication:**
   - Start VNC service: `docker-compose --profile setup up`
   - Access noVNC at http://localhost:6080
   - Open browser, navigate to claude.ai
   - Complete login (including 2FA if needed)
   - Save session state
   - Verify state file exists in mounted volume

3. **Session Persistence Test:**
   - Stop and remove containers
   - Start backend only (not VNC)
   - Load saved profile in Playwright
   - Navigate to Claude without login prompt
   - Confirm still authenticated

4. **Document Authentication Process:**
   - Create step-by-step guide in README
   - Include screenshots for each service
   - Note any service-specific quirks

**ONLY PROCEED IF ALL PHASE 0 TESTS PASS**

### PHASE 1 - Foundation

1. Project structure setup
2. Docker environment (validated from Phase 0)
3. FastAPI backend skeleton
4. Database setup with external content FTS5
5. SQLAlchemy/Tortoise-ORM models
6. Basic API endpoints (health, stats)
7. Simple frontend shell

**Before proceeding, show me:**
- Complete database schema SQL
- API endpoint structure (OpenAPI spec)
- Base scraper class design
- Docker configuration files

### PHASE 2 - First Scraper (Claude - Proof of Concept)

1. Implement BaseScraper class
2. Create Claude-specific scraper:
   - Identify API endpoints (use browser DevTools)
   - Implement request interception
   - Handle streaming if present
   - Parse conversation structure
3. Session management and health checks
4. Test full flow:
   - Authenticate via VNC
   - Run scraper
   - Verify data in database
   - Test search functionality

**Before proceeding, demonstrate:**
- Successful scrape of 10 conversations
- FTS5 search returning results
- Session persistence after restart

### PHASE 3 - Core Features

1. StreamBuffer implementation for SSE handling
2. Import system for official exports (faster initial load)
3. Full search implementation with highlighting
4. Complete frontend (search interface + dashboard)
5. Scheduled scraping with APScheduler
6. Error handling and retry logic

### PHASE 4 - Additional Services

1. ChatGPT scraper (SSE streaming - most complex)
2. Gemini scraper
3. Perplexity scraper
4. Per-service error isolation

### PHASE 5 - Polish & Production

1. Comprehensive logging
2. Re-authentication workflows
3. Rate limiting and backoff
4. Security hardening
5. Complete documentation
6. Performance optimization

## CRITICAL CONSIDERATIONS

### Authentication (Biggest Challenge)

- Sessions expire after days/weeks (varies by service)
- Implement session health checks before each scrape
- Alert user when re-auth needed (dashboard indicator)
- VNC provides manual intervention path for 2FA
- Document that some services may require weekly re-auth

### Anti-Detection

- Use playwright-stealth (install: `pip install playwright-stealth`)
- Randomize delays: 1-3 seconds between requests
- Realistic user agents (update quarterly)
- Respect rate limits (exponential backoff: 1s, 2s, 4s, 8s...)
- Monitor for CAPTCHAs (log and alert, don't crash)

### Error Handling Philosophy

- Each scraper runs in isolation (one failure doesn't break others)
- Log all errors with full context (traceback, service, timestamp)
- Track consecutive failures (alert after 3+)
- Provide manual override options in dashboard
- Never crash the entire system for one service issue

### Security

- Browser profiles contain sensitive session cookies
- Set Docker volume permissions: `chmod 700 volumes/`
- Add basic API authentication (API keys) before exposing externally
- Consider database encryption at rest (optional, document trade-offs)
- CORS protection on API endpoints

### Performance

- Use async/await throughout (Playwright, FastAPI, database)
- External content FTS5 for fast updates
- Index frequently queried columns
- Pagination on all list endpoints
- Consider caching for stats/dashboard

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

## QUESTIONS TO ANSWER BEFORE STARTING

Before writing any code, provide detailed answers to:

1. **Show me the complete Dockerfile** with Playwright base image and all dependencies
2. **Show me the docker-compose.yml** with shm_size, volumes, VNC setup
3. **Show me the complete database schema** including FTS5 external content tables and triggers
4. **Explain your strategy for handling ChatGPT's SSE streaming** - how will you detect completion?
5. **Describe the authentication setup process step-by-step** - what will the user experience?
6. **Show me the BaseScraper class** with browser context management
7. **Show me how you'll implement the /api/scrape endpoint** with background tasks

## START HERE

Create the project structure, then answer all 7 questions above. Do not proceed with implementation until these architectural decisions are reviewed and approved. The goal is to build the foundation correctly before adding complexity.

---

**Take time to plan before coding. Ask clarifying questions if anything is ambiguous.**
