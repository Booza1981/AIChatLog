# Chat History Search System

A self-hosted solution for syncing and searching your chat conversations from Claude, ChatGPT, Gemini, and Perplexity.

## 📖 Documentation

- **[CURRENT_STATUS.md](./CURRENT_STATUS.md)** - Current implementation status, architecture, what's working
- **[DEVTOOLS_BUG.md](./DEVTOOLS_BUG.md)** - Critical bug: Extension only works with DevTools open
- **[PROJECT_SPEC.md](./PROJECT_SPEC.md)** - Original technical specification
- **[chrome-extension/README.md](./chrome-extension/README.md)** - Extension installation guide

## ⚠️ Legal Disclaimer

**This tool is for personal use only** to create a searchable archive of your own chat conversations.

- You are responsible for compliance with each service's Terms of Service
- This tool is not affiliated with or endorsed by Anthropic, OpenAI, Google, or Perplexity
- Use at your own risk and discretion
- Not intended for commercial use or redistribution
- Author assumes no liability for TOS violations or account actions

By using this tool, you acknowledge that you have read and understood the terms of service for each platform you scrape.

## 🚀 Quick Start

**Important:** This project now uses a **Chrome extension** approach instead of Playwright scraping. See [CURRENT_STATUS.md](./CURRENT_STATUS.md) for details.

### Prerequisites

- Docker and Docker Compose installed
- Chrome browser
- ~2GB disk space (for Docker images and database)

### Setup Steps

#### 1. Start Backend Services

```bash
# Copy environment file (optional)
cp .env.example .env

# Start backend and frontend
docker-compose up -d

# Check logs
docker-compose logs -f backend
```

#### 2. Install Chrome Extension

```bash
# Open Chrome and go to:
chrome://extensions/

# Enable "Developer mode" (toggle in top-right)

# Click "Load unpacked"

# Select the extension directory:
# /home/booza/AIChatLog/chrome-extension
```

#### 3. Sync Your Conversations

```bash
# 1. Open https://claude.ai in Chrome (log in normally)
# 2. Click the extension icon in your toolbar
# 3. Click "Sync All Conversations"
# 4. Click "OK" on confirmation
# 5. Watch the progress notification

# KNOWN ISSUE: Extension currently only works when DevTools is open
# Workaround: Right-click extension icon → "Inspect" → then click "Sync All"
# See DEVTOOLS_BUG.md for details
```

#### 4. Use the Search Interface

Open http://localhost:3000 in your browser!

**Features:**
- **Recent Conversations** - Browse your 15 most recent chats on the main page
- **Dual Links** - Each conversation has two buttons:
  - "Open in Claude" - Opens the chat on claude.ai
  - "View Local" - Shows your archived copy
- **Full-Text Search** - Search across all conversations
- **Filter by Service** - Claude, ChatGPT, Gemini, Perplexity
- **Date Filters** - Search within specific time ranges

### Running the Application

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f backend

# Access the application
# - Search interface: http://localhost:3000
# - API: http://localhost:8000
# - API docs: http://localhost:8000/docs
```

## 📁 Project Structure

```
chat-history-search/
├── backend/
│   ├── Dockerfile              # Playwright-based container
│   ├── requirements.txt        # Python dependencies
│   ├── test_playwright.py      # Infrastructure validation
│   ├── main.py                 # FastAPI application (Phase 1)
│   ├── database.py             # SQLite + FTS5 setup
│   ├── models.py               # Database models
│   ├── scheduler.py            # Periodic scraping
│   ├── stream_buffer.py        # SSE/WebSocket handler
│   ├── scrapers/
│   │   ├── base.py             # Base scraper class
│   │   ├── claude.py           # Claude scraper
│   │   ├── chatgpt.py          # ChatGPT scraper
│   │   ├── gemini.py           # Gemini scraper
│   │   └── perplexity.py       # Perplexity scraper
│   ├── importers/              # Import from official exports
│   └── scripts/                # Utility scripts
├── frontend/
│   ├── index.html              # Search interface
│   ├── dashboard.html          # Monitoring dashboard
│   └── styles.css
├── volumes/
│   ├── browser-profiles/       # Persistent sessions
│   └── database/               # SQLite database
├── docker-compose.yml
├── .env.example
└── README.md
```

## 🔧 Configuration

Edit `.env` to customize:

```bash
# How often to scrape (in hours)
SCRAPE_INTERVAL_HOURS=2

# Logging level
LOG_LEVEL=INFO

# VNC password (change for security)
VNC_PASSWORD=your-secure-password
```

## 🔍 API Endpoints

### Scraping

```bash
# Trigger manual scrape
curl -X POST http://localhost:8000/api/scrape/claude

# Scrape all services
curl -X POST http://localhost:8000/api/scrape/all

# Check scrape status
curl http://localhost:8000/api/scrape/status/{job_id}
```

### Search

```bash
# Search conversations
curl "http://localhost:8000/api/search?q=machine+learning&source=claude"

# Get recent conversations
curl "http://localhost:8000/api/recent?limit=15"

# Get statistics
curl http://localhost:8000/api/stats
```

### Health Check

```bash
# Check service health
curl http://localhost:8000/api/health
```

## 🛠️ Troubleshooting

### Browser Crashes

**Symptom:** Chromium crashes with "Out of memory" errors

**Solution:** Ensure `shm_size: '2gb'` is set in docker-compose.yml

```yaml
backend:
  shm_size: '2gb'  # CRITICAL
```

### Session Expired

**Symptom:** Dashboard shows "Session expired" for a service

**Solution:** Re-authenticate using VNC:
```bash
docker-compose --profile setup up vnc
# Then repeat login steps for that service
```

### No Conversations Found

**Symptom:** Scraper runs but finds no conversations

**Possible causes:**
1. Session not authenticated - check dashboard status
2. Selectors changed - service UI updated (needs scraper update)
3. Rate limiting - wait 1 hour and retry

### Docker Build Fails

**Symptom:** `playwright install` fails during build

**Solution:** Ensure stable internet connection and sufficient disk space (5GB+)

## 📊 Database Schema

Uses SQLite with FTS5 (Full-Text Search) for performance:

- **conversations**: Main conversation metadata
- **messages**: Individual messages (normalized)
- **conversations_fts**: FTS5 virtual table for fast search
- **scraper_status**: Health tracking per service

See `PROJECT_SPEC.md` for detailed schema.

## 🔐 Security Notes

- Browser profiles contain sensitive session cookies
- Recommended: Set volume permissions `chmod 700 volumes/`
- Do NOT expose ports 8000/3000 externally without authentication
- VNC service should only run during setup (not in production)

## 🚧 Development Status

**Current Implementation:** Chrome Extension + API Sync ✅

**What's Working:**
- ✅ FastAPI backend with SQLite + FTS5 search
- ✅ **Modern frontend with recent conversations display**
- ✅ **Dual link system** - Open in Claude.ai/Gemini OR view local archive
- ✅ **Chrome extension with Claude API integration** - Full sync of all conversations
- ✅ **Chrome extension with Gemini API integration** - Full sync with pagination
- ✅ **Gemini pagination** - Continuation token approach for complete history
- ✅ **Multiple message exchanges** - Full conversation history per chat
- ✅ **Chronological message ordering** - Proper oldest-to-newest sorting
- ✅ Progress tracking and notifications
- ✅ Automatic console logging for debugging
- ✅ Responsive mobile-friendly UI

**Known Issues:**
- ⚠️ ChatGPT and Perplexity not yet implemented (Claude and Gemini work perfectly!)

**Next Steps:**
- Add ChatGPT API sync
- Add Perplexity API sync
- Enable auto-sync scheduling
- Add conversation tagging
- Enhanced search filters

## 📝 Contributing

This is a personal-use tool. If you find bugs or have improvements:

1. Understand the phased implementation approach (see PROJECT_SPEC.md)
2. Validate changes don't break existing scrapers
3. Test session persistence after changes
4. Update documentation

## 📚 Additional Resources

- [Playwright Documentation](https://playwright.dev/python/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [PROJECT_SPEC.md](./PROJECT_SPEC.md) - Detailed technical specification

## 🎯 Roadmap

- [x] Phase 0: Infrastructure validation
- [x] Phase 1: Core backend and database
- [x] Phase 2: Claude scraper (POC)
- [ ] Phase 3: Search and import system
- [ ] Phase 4: Additional service scrapers
- [ ] Phase 5: Production hardening
- [ ] Export functionality
- [ ] Advanced search filters
- [ ] Conversation tagging
- [ ] API authentication

## 📄 License

For personal use only. See disclaimer above.
