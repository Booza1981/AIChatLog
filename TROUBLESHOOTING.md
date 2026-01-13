# Troubleshooting Guide

Common issues and solutions for the AI Chat History extension and backend.

## Extension Issues

### Extension Not Loading

**Symptom:** Extension icon doesn't appear in toolbar or extension doesn't show in list

**Solution:**
1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Check if "Chat History Sync" appears in the list
4. If not, click "Load unpacked" and select the `chrome-extension` directory
5. If it's there but disabled, click the toggle to enable it

### Backend Unreachable

**Symptom:** Extension shows "Failed to connect to backend" or sync buttons don't work

**Solution:**
1. Check backend is running: `docker ps` should show `chat-history-backend` container
2. If not running: `docker-compose up -d` from project root
3. Verify backend is accessible: Open http://localhost:8000 in browser
4. Check backend logs: `docker logs chat-history-backend -f`

### Sync Fails Silently

**Symptom:** Click sync button, nothing happens or shows error

**Solution:**
1. Open browser console (F12) on Claude/Gemini/ChatGPT page
2. Look for errors starting with `[Claude]`, `[Gemini]`, or `[ChatGPT]`
3. Common causes:
   - Content script not loaded: Reload the extension
   - Not on correct page: Must be on claude.ai, gemini.google.com, or chat.openai.com
   - Authentication expired: Refresh the page to renew session

### Authentication Expired

**Symptom:** Sync fails with "Session unhealthy" or "Authentication failed"

**Solution:**
1. Refresh the Claude/Gemini/ChatGPT page
2. If still failing, log out and log back in
3. Reload the extension
4. Try syncing again

### Recent Conversations Missing

**Symptom:** Latest conversations don't appear in dashboard

**Solution:**
1. Use "Sync All Conversations" instead of "Sync Current"
2. Check console for errors during sync
3. Verify conversations appear in the service's sidebar
4. If conversations are very new (< 1 minute), wait and retry

### Gemini Sync Shows 0 Messages

**Symptom:** Gemini conversations sync but all show 0 messages

**Solution:**
1. This was a known issue fixed in commit `bab5d9f`
2. Update to latest version: `git pull origin main`
3. Reload the Chrome extension
4. Clear Gemini data and re-sync: `docker exec chat-history-backend python /app/scripts/clear_gemini.py`
5. Run "Sync All Conversations" again

### Duplicate Conversations

**Symptom:** Same conversation appears multiple times in search results

**Solution:**
1. This was fixed in commit `69ec1fc`
2. Update to latest version: `git pull origin main`
3. Run duplicate cleanup: `docker exec chat-history-backend python /app/scripts/fix_gemini_duplicates.py`

## Backend Issues

### Database Locked Error

**Symptom:** Backend logs show "database is locked" errors

**Solution:**
1. Stop the backend: `docker-compose stop backend`
2. Wait 5 seconds
3. Restart: `docker-compose start backend`
4. If persists, restart entire stack: `docker-compose restart`

### Frontend Not Loading

**Symptom:** http://localhost:3000 shows connection refused or blank page

**Solution:**
1. Check frontend container: `docker ps | grep frontend`
2. If not running: `docker-compose up -d frontend`
3. Check frontend logs: `docker logs chat-history-frontend -f`
4. Hard refresh browser: Ctrl+Shift+R (or Cmd+Shift+R on Mac)

### Search Not Working

**Symptom:** Search returns no results or shows errors

**Solution:**
1. Check backend logs for SQL errors
2. Verify conversations exist: Open http://localhost:8000/api/stats
3. Try searching for a single word (not a phrase)
4. Check FTS index: `docker exec chat-history-backend sqlite3 /app/volumes/database/conversations.db "SELECT count(*) FROM conversations_fts;"`

### Container Won't Start

**Symptom:** `docker-compose up` fails or containers crash immediately

**Solution:**
1. Check logs: `docker-compose logs backend` or `docker-compose logs frontend`
2. Verify ports aren't in use: `lsof -i :8000` and `lsof -i :3000`
3. Remove old containers: `docker-compose down`
4. Rebuild: `docker-compose up --build`
5. Check disk space: `df -h`

## Auto-Sync Issues

### Auto-Sync Not Running

**Symptom:** Conversations don't sync automatically every 2 hours

**Solution:**
1. Check auto-sync is enabled in extension popup
2. Verify sync interval setting (default: 2 hours)
3. Browser must stay open with tabs on Claude/Gemini/ChatGPT
4. Check background service worker: `chrome://extensions` → "service worker" link under extension → check console for errors

### Auto-Sync Only Works for One Service

**Symptom:** Only Claude syncs automatically, not Gemini

**Solution:**
1. Open extension popup
2. Check that toggles are enabled for all desired services
3. Ensure tabs are open for services you want to auto-sync
4. Background worker only syncs services with open tabs

## Database Issues

### Corrupted Database

**Symptom:** Backend crashes, SQL errors, or integrity check failures

**Solution:**
1. Backup database: `docker cp chat-history-backend:/app/volumes/database/conversations.db ./backup.db`
2. Try repair: `docker exec chat-history-backend sqlite3 /app/volumes/database/conversations.db "PRAGMA integrity_check;"`
3. If corrupted, restore from backup or delete and re-sync:
   ```bash
   docker-compose down
   rm -rf volumes/database/conversations.db
   docker-compose up -d
   # Re-sync all conversations from extension
   ```

### Reset Everything

**Symptom:** Want to start completely fresh

**Solution:**
```bash
# Stop all containers
docker-compose down

# Remove database
rm -rf volumes/database/

# Restart
docker-compose up -d

# Re-sync all conversations from extension
```

## Getting Help

If these solutions don't help:

1. **Check console logs** - Most issues show error details in browser console (F12)
2. **Check backend logs** - `docker logs chat-history-backend -f`
3. **Check GitHub issues** - https://github.com/Booza1981/AIChatLog/issues
4. **File a new issue** - Include:
   - Extension console logs (F12 on Claude/Gemini page)
   - Backend logs (`docker logs chat-history-backend`)
   - Steps to reproduce
   - Browser version and OS

## Known Limitations

- **Gemini Desktop App Conflict**: If Gemini desktop app is open, clicking "Open in Gemini" links may cause conflicts
- **ChatGPT Not Implemented**: ChatGPT sync toggle is visible but functionality not yet implemented
- **Perplexity Not Supported**: Perplexity.ai not yet supported
- **No Conversation Export**: Can view conversations in dashboard but can't export them yet
- **Single User**: No multi-user support, designed for personal self-hosted use
