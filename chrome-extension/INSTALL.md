# Installation Guide

## Quick Start (5 minutes)

### Step 1: Start Backend
```bash
cd /home/booza/AIChatLog
docker-compose up -d backend
```

### Step 2: Install Extension in Chrome

1. Open **Chrome** (or Brave, Edge, etc.)
2. Go to `chrome://extensions/`
3. Enable **"Developer mode"** (toggle in top right corner)
4. Click **"Load unpacked"**
5. Navigate to and select: `/home/booza/AIChatLog/chrome-extension`
6. The extension icon will appear in your toolbar

![Extension loaded successfully]

### Step 3: Test It

1. Open [Claude.ai](https://claude.ai) in a new tab
2. Make sure you're logged in and can see your conversations
3. Click the extension icon in your toolbar
4. Click **"Sync Current"**
5. You should see a green "✓ Claude conversations synced" notification

### Step 4: View Your Data

Open [http://localhost:3000](http://localhost:3000) to see your synced conversations

---

## Configuration

### Auto-Sync Settings

Click the extension icon to configure:

- **Sync Interval**: How often to automatically sync (default: every 2 hours)
- **Enabled Services**: Toggle which services to sync (Claude/ChatGPT/Gemini)

### How Auto-Sync Works

Once enabled, the extension will:
- Run in the background every N hours
- Only sync from tabs you have open
- Show a notification when complete
- Update "last sync" time in the popup

---

## Troubleshooting

### "Failed to fetch" error

**Problem**: Extension can't reach the backend

**Solution**:
```bash
# Check backend is running
docker-compose ps

# Check backend health
curl http://localhost:8000/api/health

# Restart if needed
docker-compose restart backend
```

### No conversations found

**Problem**: Extension can't find conversations on the page

**Solutions**:
1. Make sure you're on the right page:
   - Claude: https://claude.ai/chat/...
   - ChatGPT: https://chat.openai.com or https://chatgpt.com
2. Wait for page to fully load
3. Check browser console for errors (F12 → Console tab)

### Extension not appearing

**Problem**: Chrome didn't load the extension properly

**Solutions**:
1. Go to `chrome://extensions/`
2. Find "Chat History Sync"
3. Check for any error messages (red text)
4. Click the "Reload" icon (circular arrow)
5. If errors persist, click "Remove" and reinstall

### Auto-sync not working

**Problem**: Extension isn't syncing automatically

**Checks**:
1. Extension icon → Check sync interval is set
2. Check "Auto-sync" toggle is ON
3. Keep at least one service tab open (claude.ai, etc.)
4. Chrome must be running (extensions don't run when browser is closed)

---

## Advanced

### Manual Testing

Test the import endpoint directly:
```bash
curl -X POST http://localhost:8000/api/import/claude \
  -H "Content-Type: application/json" \
  -d '{
    "conversations": [{
      "conversation_id": "test123",
      "title": "Test Conversation",
      "source": "claude",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "messages": [
        {"role": "user", "content": "Hello", "timestamp": "2024-01-01T00:00:00Z", "sequence_number": 0}
      ]
    }]
  }'
```

### View Extension Logs

1. Go to `chrome://extensions/`
2. Find "Chat History Sync"
3. Click "service worker" (blue link)
4. This opens DevTools showing background script logs

### View Content Script Logs

1. Open Claude.ai (or other service)
2. Press F12 to open DevTools
3. Go to Console tab
4. Look for `[Claude]` prefixed messages

---

## Updating the Extension

When you make changes to the extension code:

1. Go to `chrome://extensions/`
2. Find "Chat History Sync"
3. Click the reload icon (circular arrow)
4. The extension will reload with your changes

No need to remove and re-add!

---

## Icons

The extension currently uses placeholder icons. To add proper icons:

1. Create 16x16, 48x48, and 128x128 PNG images
2. Save them as:
   - `icons/icon16.png`
   - `icons/icon48.png`
   - `icons/icon128.png`
3. Reload the extension

You can use any icon generator online or design your own.

---

## Next Steps

1. **Test with Claude/ChatGPT/Gemini** - All three are implemented
2. **Customize** - Modify the popup UI, add features, etc.

The extension architecture is simple and extensible!
