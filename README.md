# Chat History Search System

A self-hosted solution for syncing and searching your chat conversations from Claude, ChatGPT, and Gemini.

## 📖 Documentation

- **[CURRENT_STATUS.md](./CURRENT_STATUS.md)** - Current implementation status, architecture, what's working
- **[PROJECT_SPEC.md](./PROJECT_SPEC.md)** - Technical specification and architecture
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Common issues and solutions
- **[chrome-extension/README.md](./chrome-extension/README.md)** - Extension installation guide

## ⚠️ Legal Disclaimer

**This tool is for personal use only** to create a searchable archive of your own chat conversations.

- You are responsible for compliance with each service's Terms of Service
- This tool is not affiliated with or endorsed by Anthropic, OpenAI, Google, or Perplexity
- Use at your own risk and discretion
- Not intended for commercial use or redistribution
- Author assumes no liability for TOS violations or account actions

By using this tool, you acknowledge that you have read and understood the terms of service for each platform you sync.

## 🚀 Quick Start

**Important:** This project now uses a **Chrome extension** approach instead of Playwright scraping. See [CURRENT_STATUS.md](./CURRENT_STATUS.md) for details.

### Prerequisites

- Docker and Docker Compose installed
- Chrome browser (or Chromium)
- ~2GB disk space (for Docker images and database)

### Setup Steps

#### 1. Start Backend Services

```bash
# Copy environment file (optional)
cp .env.example .env

# Start backend and frontend (plus Chromium container for server deployments)
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

1. Open https://claude.ai, https://chatgpt.com, or https://gemini.google.com in Chrome (log in normally)
2. Click the extension icon in your toolbar
3. Click "Sync Current" (active tab), "Sync All", or "Quick Sync" (incremental)
4. Wait for sync to complete (progress shown in on-page notification)

**Tip:** The sync runs in the background. You can continue browsing while it completes.

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

### Local Development Overrides

`docker-compose.override.yml` restores backend/frontend bind mounts for hot reloads in local development. It is automatically picked up by `docker-compose up -d`.

### Server Deployment Notes

- The `chromium` service runs a browser with the extension preloaded for automatic syncing.
- Override host ports and storage paths with stack env vars:
  - `BACKEND_PORT`, `FRONTEND_PORT`
  - `DATABASE_VOLUME_PATH`, `CHROMIUM_CONFIG_PATH`
- After redeploying the stack, reload the extension in Chromium (`chrome://extensions`) if it doesn’t pick up changes automatically.

### External Access / Auth (Out of Repo)

Reverse proxy, SSO, or access-control layers (Traefik/Authelia/Cloudflare Workers, etc.) are intentionally **not** tracked in this repo.
Keep those in a separate, local Portainer stack or a non‑Git compose file so the app repo stays focused and portable.

## 📁 Project Structure

```
AIChatLog/
├── chrome-extension/            # Chrome extension
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── background.js            # Auto-sync service worker
│   └── content-scripts/
│       ├── claude.js            # Claude sync
│       ├── claude-api.js
│       ├── chatgpt.js           # ChatGPT sync
│       ├── chatgpt-api.js
│       ├── gemini.js            # Gemini sync
│       └── gemini-api.js
├── backend/                     # FastAPI server (Docker)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                  # API endpoints
│   ├── database.py              # SQLite + FTS5
│   ├── models.py
├── frontend/                    # Search UI (Docker)
│   ├── Dockerfile
│   ├── index.html
│   └── styles.css
├── scripts/                     # Maintenance scripts
│   ├── clear_gemini.py
│   └── fix_gemini_duplicates.py
├── volumes/                     # Created at runtime
│   └── database/                # SQLite database
├── docs/
│   └── archived/                # Outdated Playwright docs
├── docker-compose.yml
└── README.md
```

## 🔧 Configuration

### Extension Settings

Configure auto-sync in the extension popup:
- **Auto-sync interval:** 1, 2, 4, 12, or 24 hours
- **Service toggles:** Enable/disable Claude, Gemini, ChatGPT
- Click the extension icon to access settings

### Backend Configuration (Optional)

No configuration required for basic usage. Backend runs on default ports:
- API: http://localhost:8000
- Frontend: http://localhost:3000

For server deployments, you can override host ports and storage paths:
- `BACKEND_PORT` / `FRONTEND_PORT`
- `DATABASE_VOLUME_PATH`
- `CHROMIUM_CONFIG_PATH`

## 🔍 API Endpoints

The extension syncs conversations using `/api/import/{service}`. You can also query the API directly:

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

For common issues and solutions, see **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)**.

Quick fixes:
- **Extension not loading**: Enable Developer mode in chrome://extensions
- **Backend unreachable**: Run `docker-compose up -d`
- **Sync fails**: Open console (F12) on Claude/Gemini page to see error details
- **Recent conversations missing**: Use "Sync All" instead of "Sync Current"

## 📊 Database Schema

Uses SQLite with FTS5 (Full-Text Search) for performance:

- **conversations**: Main conversation metadata
- **messages**: Individual messages (normalized)
- **conversations_fts**: FTS5 virtual table for fast search
- **scraper_status**: Legacy table (not used in extension sync flow)

See `PROJECT_SPEC.md` for detailed schema.

## 🔐 Security Notes

- Extension uses your browser's existing authentication (no separate login)
- Database stored locally in Docker volume (not cloud-synced)
- Do NOT expose ports 8000/3000 externally without adding authentication
- Extension only runs on claude.ai, gemini.google.com, chat.openai.com, chatgpt.com (limited host permissions)

## 🚧 Development Status

**Current Implementation:** Chrome Extension + API Sync ✅

**What's Working:**
- ✅ FastAPI backend with SQLite + FTS5 search
- ✅ **Modern frontend with recent conversations display**
- ✅ **Dual link system** - Open in Claude.ai/Gemini OR view local archive
- ✅ **Chrome extension with Claude API integration** - Full sync of all conversations
- ✅ **Chrome extension with ChatGPT API integration** - Full sync with bearer token auth
- ✅ **Chrome extension with Gemini API integration** - Full sync with pagination
- ✅ **Smart incremental sync** - Quick Sync only fetches new/updated conversations
- ✅ **Multiple message exchanges** - Full conversation history per chat
- ✅ **Chronological message ordering** - Proper oldest-to-newest sorting
- ✅ Progress tracking and notifications
- ✅ Automatic console logging for debugging
- ✅ Responsive mobile-friendly UI

**Known Issues:**
- ⚠️ Perplexity not yet implemented (Claude, ChatGPT, and Gemini work!)

**Next Steps:**
- Add Perplexity API sync
- Add conversation tagging
- Enhanced search filters

## 📝 Contributing

This is a personal-use tool. If you find bugs or have improvements:

1. Understand the phased implementation approach (see PROJECT_SPEC.md)
2. Validate changes don't break existing extension sync flows
3. Test session persistence after changes
4. Update documentation

## 📚 Additional Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [PROJECT_SPEC.md](./PROJECT_SPEC.md) - Detailed technical specification
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions

## 🎯 Roadmap

### Completed
- [x] Chrome extension with Manifest V3
- [x] Claude sync with API interception
- [x] ChatGPT sync with bearer token auth
- [x] Gemini sync with batchexecute API
- [x] FastAPI backend with SQLite + FTS5
- [x] Full-text search with highlighting
- [x] Recent conversations display
- [x] Auto-sync background service worker
- [x] Smart incremental sync (Quick Sync)

### In Progress
- [ ] Perplexity sync implementation

### Future
- [ ] Export functionality
- [ ] Advanced search filters
- [ ] Conversation tagging

## 📄 License

For personal use only. See disclaimer above.
