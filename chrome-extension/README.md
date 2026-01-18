# Chat History Sync - Chrome Extension

Automatically syncs your AI chat conversations to your local database.

## Features

- ✅ **Automatic syncing** - Runs every 2 hours (configurable)
- ✅ **Multiple services** - Claude, ChatGPT, Gemini support
- ✅ **Zero bot detection** - Runs in your real browser with real authentication
- ✅ **Privacy first** - Data stays on your machine (backend API)
- ✅ **Manual trigger** - Click to sync anytime

## Installation

### 1. Ensure Backend is Running

```bash
cd /home/booza/AIChatLog
docker-compose up -d backend
```

### 2. Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `chrome-extension` folder
5. The extension icon will appear in your toolbar

**Server deployment (Chromium container):** the extension is baked into the Chromium image. After a stack redeploy, visit `chrome://extensions` in that browser and click reload if it doesn’t update automatically.

### 3. Configure

1. Click the extension icon
2. Enable services you want to sync
3. Set sync interval (default: 2 hours)
4. Click "Sync Current" to test

## Usage

### Automatic Syncing

Once installed and configured, the extension will automatically:
- Sync conversations every 2 hours (or your configured interval)
- Only sync from tabs you have open
- Respect which services you've enabled

### Manual Syncing

1. Navigate to claude.ai (or other supported service)
2. Click the extension icon
3. Click "Sync Current"
4. Check the dashboard at http://localhost:3000

## How It Works

1. **Content Scripts** run on claude.ai, chat.openai.com, etc.
2. **Extract conversations** directly from the DOM (real browser, no bot detection)
3. **POST to backend** API endpoint (`/api/import/{service}`)
4. **Backend saves** to SQLite database with FTS5 indexing

## Supported Services

| Service | Status | Notes |
|---------|--------|-------|
| Claude  | ✅ Implemented | Fully working |
| ChatGPT | ✅ Implemented | Fully working |
| Gemini  | ✅ Implemented | Fully working |

## Development

### Testing

1. Open Developer Tools on any supported site
2. Check Console tab for `[Claude]` or `[ChatGPT]` logs
3. Watch for sync messages

### Debugging

- **Check backend logs**: `docker-compose logs -f backend`
- **Check extension logs**: Chrome DevTools → Console (on the site)
- **Check background logs**: `chrome://extensions/` → "service worker" → Inspect

### Adding New Services

1. Create `content-scripts/{service}.js`
2. Implement `extractConversations()` function
3. Add to `manifest.json` content_scripts
4. Add service toggle to popup.html

## Troubleshooting

### "Failed to fetch" error
- Ensure backend is running: `docker-compose ps`
- Check backend URL: `curl http://localhost:8000/api/health` (or your server host port)

### No conversations found
- Navigate to the conversations page (e.g., claude.ai/chats)
- Wait for page to fully load
- Check browser console for errors

### Auto-sync not working
- Check that service is enabled in popup
- Check that you have a tab open for that service
- Check Chrome extensions are allowed to run

## Privacy & Security

- All data stays on your local machine
- No external servers involved
- Extension communicates with the backend API (localhost in dev, `backend:8000` in Docker)
- Your authentication cookies stay in your browser

## License

For personal use only. See main project LICENSE.
