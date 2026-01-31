# AIChatLog Server Deployment Plan

## Overview
Migrate AIChatLog from local development to server deployment with automatic syncing via a containerized Chromium browser running the extension.

## Architecture Decision: Combined Stack (Recommended)

A single docker-compose stack containing all services:
- **backend** - FastAPI + SQLite/FTS5
- **frontend** - Nginx static files
- **chromium** - linuxserver/chromium with extension pre-loaded

**Rationale:**
- Simpler networking (containers share bridge network, use DNS names)
- Single deploy/update operation in Portainer
- Easier to manage dependencies and health checks

---

## Implementation Steps

### 1. Make Extension Endpoint Configurable

Currently, `localhost:8000` is hardcoded in 6 files. For Docker deployment, the extension needs to reach the backend container.

**Files to modify:**

| File | Line | Change |
|------|------|--------|
| `chrome-extension/background.js` | 6 | `API_BASE` |
| `chrome-extension/auto-logger.js` | 6 | `BACKEND_URL` |
| `chrome-extension/content-scripts/claude.js` | 7 | `API_BASE` |
| `chrome-extension/content-scripts/chatgpt.js` | 12 | `API_BASE` |
| `chrome-extension/content-scripts/gemini.js` | 15 | `API_BASE` |
| `chrome-extension/manifest.json` | 17 | `host_permissions` |

**Approach:** Create a shared config that reads from environment or defaults:
- For Docker: Use `http://backend:8000` (Docker DNS)
- For local dev: Use `http://localhost:8000`

### 2. Update docker-compose.yml

Add chromium service to existing compose file:

```yaml
chromium:
  image: lscr.io/linuxserver/chromium:latest
  container_name: aichatlog-chromium
  security_opt:
    - seccomp:unconfined
  environment:
    - PUID=1000
    - PGID=1000
    - TZ=${TZ:-Etc/UTC}
    - CHROME_CLI=--disable-dev-shm-usage --no-sandbox --disable-blink-features=AutomationControlled --disable-infobars --disable-background-timer-throttling --load-extension=/config/extension
  volumes:
    - chromium-config:/config
    - ./chrome-extension:/config/extension:ro
  ports:
    - "3700:3000"  # KasmVNC web UI
    - "3701:3001"  # HTTPS
  shm_size: "2gb"
  devices:
    - /dev/dri:/dev/dri
  depends_on:
    backend:
      condition: service_healthy
  restart: unless-stopped
  networks:
    - chat-history-net
```

### 3. Stealth Flags

Chrome flags for anti-detection (already in user's tested config, plus additions):

```
--disable-blink-features=AutomationControlled  # Removes navigator.webdriver
--disable-infobars                              # Hides automation banner
--disable-background-timer-throttling           # Ensures alarms fire on schedule
--disable-backgrounding-occluded-windows        # Keeps tabs active
--disable-renderer-backgrounding                # Prevents tab throttling
```

### 4. Initial Setup Workflow

1. Deploy stack via Portainer
2. Access KasmVNC at `http://server:3700`
3. Log in to Claude, ChatGPT, Gemini in the browser
4. Keep tabs open (extension needs active tabs)
5. Verify extension popup shows services connected
6. Trigger initial "Sync All" for each service
7. Configure auto-sync interval in extension popup

### 5. Session Persistence

The `chromium-config` volume preserves:
- Browser cookies and sessions
- Extension local storage (sync state)
- Browser preferences

Sessions should survive container restarts.

---

## Files to Modify

### Critical Changes
1. **docker-compose.yml** - Add chromium service, update network/volumes
2. **chrome-extension/background.js:6** - Change API_BASE
3. **chrome-extension/auto-logger.js:6** - Change BACKEND_URL
4. **chrome-extension/content-scripts/claude.js:7** - Change API_BASE
5. **chrome-extension/content-scripts/chatgpt.js:12** - Change API_BASE
6. **chrome-extension/content-scripts/gemini.js:15** - Change API_BASE
7. **chrome-extension/manifest.json:17** - Add `http://backend:8000/*` to host_permissions
8. **.env** - Add TZ

### Optional Security Enhancement
- Add API key authentication to backend (middleware in `main.py`)
- Extension sends API key in headers

---

## Resource Requirements

| Component | Memory |
|-----------|--------|
| Backend | 256-512 MB |
| Frontend | 64 MB |
| Chromium | 2-4 GB |
| **Total** | ~3-5 GB |

---

## Verification Plan

1. `docker-compose up -d` and check all containers healthy
2. Access frontend at `http://server:3000` - should load
3. Access KasmVNC at `http://server:3700` - should show browser
4. In browser, navigate to `chrome://extensions` - extension should be loaded
5. Open Claude/ChatGPT/Gemini tabs, verify login persists
6. Click extension popup, trigger sync, check backend logs
7. Wait for auto-sync interval, verify it fires automatically
8. Search in frontend UI - conversations should appear

---

## User Decisions

1. **Endpoint Strategy**: Server-only - hardcode `backend:8000` in extension
2. **Security**: No API key - ports exposed locally, external access via Cloudflare tunnel
3. **Port Exposure**: Expose all ports locally (secure via Cloudflare tunnel, not router port forwarding)

---

## Final docker-compose.yml (With Exposed Ports)

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    container_name: aichatlog-backend
    ports:
      - "8000:8000"
    volumes:
      - ./Database:/app/volumes/database
      - ./backend:/app
    environment:
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
      - DATABASE_PATH=/app/volumes/database/conversations.db
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - aichatlog-net

  frontend:
    build: ./frontend
    container_name: aichatlog-frontend
    ports:
      - "3000:80"
    volumes:
      - ./frontend:/usr/share/nginx/html:ro
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - aichatlog-net

  chromium:
    image: lscr.io/linuxserver/chromium:latest
    container_name: aichatlog-chromium
    security_opt:
      - seccomp:unconfined
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=${TZ:-Etc/UTC}
      - CHROME_CLI=--disable-dev-shm-usage --no-sandbox --disable-blink-features=AutomationControlled --disable-infobars --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --load-extension=/config/extension
    volumes:
      - chromium-config:/config
      - ./chrome-extension:/config/extension:ro
    ports:
      - "3700:3000"   # KasmVNC HTTP
      - "3701:3001"   # KasmVNC HTTPS
    shm_size: "2gb"
    devices:
      - /dev/dri:/dev/dri
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - aichatlog-net

networks:
  aichatlog-net:
    driver: bridge

volumes:
  chromium-config:
    driver: local
```

**Access Points (on your server):**
- Frontend UI: `http://server-ip:3000`
- Backend API: `http://server-ip:8000`
- KasmVNC Browser: `http://server-ip:3700`

**Cloudflare Tunnel:**
Set up tunnels to expose only what you need externally:
- `aichatlog.yourdomain.com` → `localhost:3000` (frontend)
- `browser.yourdomain.com` → `localhost:3700` (KasmVNC for initial setup)
