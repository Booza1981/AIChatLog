# Authentication Setup Guide

This guide explains how to authenticate with each chat service so the scraper can access your conversations.

## Overview

Each service requires a one-time authentication setup using a VNC desktop environment. Once authenticated, your session is saved and will persist across container restarts.

## Prerequisites

- Docker and Docker Compose running
- Backend service running (`docker-compose up -d backend`)
- Web browser to access VNC

---

## Step-by-Step Authentication

### 1. Start the VNC Service

```bash
docker-compose --profile setup up -d vnc
```

This starts a VNC desktop environment accessible via your web browser.

### 2. Access the VNC Desktop

Open your web browser and navigate to:
```
http://localhost:6080
```

**Default VNC Password:** `changeme123` (configured in `.env`)

You should see a Linux desktop environment in your browser.

### 3. Authenticate with Claude.ai

#### A. Open Terminal in VNC

1. Inside the VNC desktop, open a terminal (usually found in the application menu)

#### B. Run the Session Save Script

```bash
# Inside the VNC terminal
docker exec -it chat-history-backend python scripts/save_session.py claude
```

This will:
1. Launch a browser window inside VNC
2. Navigate to https://claude.ai/chats
3. Wait for you to complete login

#### C. Complete Login

1. In the browser window that opened, log into Claude.ai
2. Complete any 2FA challenges if required
3. Verify you can see your conversation list
4. Return to the terminal and press **Enter**

#### D. Verify Session Saved

You should see:
```
✓ Session saved successfully (XXXX bytes)
✓ Session saved for claude
✓ You can now close the VNC window
```

### 4. Stop the VNC Service

After saving the session:

```bash
docker-compose --profile setup down
```

The VNC service is no longer needed - your session is now saved persistently.

### 5. Test the Scraper

```bash
# Trigger a manual scrape
curl -X POST http://localhost:8000/api/scrape/claude

# Check the job status (use job_id from response)
curl http://localhost:8000/api/scrape/status/{job_id}

# View scraped conversations
curl http://localhost:8000/api/stats
```

---

## Authenticating Other Services

Repeat the same process for other services:

### ChatGPT
```bash
docker exec -it chat-history-backend python scripts/save_session.py chatgpt
```

### Gemini
```bash
docker exec -it chat-history-backend python scripts/save_session.py gemini
```

### Perplexity
```bash
docker exec -it chat-history-backend python scripts/save_session.py perplexity
```

---

## Troubleshooting

### "Session file not created"

**Cause:** The script couldn't save the session state.

**Solution:**
1. Ensure the backend container is running
2. Check volume permissions: `chmod 700 volumes/browser-profiles`
3. Try again with verbose logging

### "Not logged in" after saving session

**Cause:** The session expired or wasn't properly saved.

**Solution:**
1. Repeat the authentication steps
2. Make sure you pressed Enter AFTER seeing the conversation list
3. Check that cookies weren't blocked in the browser

### "Session healthy" check fails

**Cause:** The service's session expired or cookies are invalid.

**Solution:**
1. Re-authenticate using the VNC process
2. Some services expire sessions after days/weeks
3. Check the dashboard for session health status

### VNC password not working

**Solution:**
Check your `.env` file and update `VNC_PASSWORD` to your desired password.

### Can't access VNC on localhost:6080

**Possible causes:**
1. VNC service not running: `docker-compose --profile setup up -d vnc`
2. Port already in use: Check if another service is using port 6080
3. Firewall blocking the port

---

## Session Management

### Viewing Session Status

Check the health of all authenticated sessions:

```bash
curl http://localhost:8000/api/health
```

Look for `session_healthy: true` for each service.

### When to Re-authenticate

You'll need to re-authenticate when:
- The session expires (varies by service, typically days/weeks)
- You change your password on the service
- The service implements new security measures
- Dashboard shows "Session expired" for a service

### Session Files Location

Sessions are stored in:
```
volumes/browser-profiles/
├── claude/
│   └── state.json
├── chatgpt/
│   └── state.json
├── gemini/
│   └── state.json
└── perplexity/
    └── state.json
```

**Security Note:** These files contain authentication cookies. Keep them secure.

---

## Advanced: Manual Browser Setup

If the automated script doesn't work, you can manually configure sessions:

### 1. Start VNC Desktop
```bash
docker-compose --profile setup up -d vnc
```

### 2. Open Browser in VNC

1. Access http://localhost:6080
2. Open Firefox/Chromium from the desktop menu
3. Navigate to the service (e.g., claude.ai)
4. Complete login manually

### 3. Export Browser Profile

This is more complex and requires manually copying browser profile files. The automated script is recommended.

---

## Security Considerations

### Session Security

- **Keep session files private:** They provide access to your accounts
- **Use strong VNC password:** Change from default in `.env`
- **Don't expose ports externally:** Keep 6080 (VNC) and 8000 (API) on localhost only
- **Regular re-authentication:** Periodically re-authenticate for security

### Network Security

For production use:
1. Add API authentication (API keys)
2. Use HTTPS with reverse proxy (nginx)
3. Restrict Docker network access
4. Enable firewall rules

### Data Privacy

- All data stays on your machine (self-hosted)
- No data sent to external services
- Conversations stored in local SQLite database
- You control all data retention

---

## Next Steps

After authenticating:

1. **Trigger First Scrape:**
   ```bash
   curl -X POST http://localhost:8000/api/scrape/claude
   ```

2. **Monitor Progress:**
   - View logs: `docker-compose logs -f backend`
   - Check status: http://localhost:8000/api/health

3. **Search Your Conversations:**
   - Open http://localhost:3000
   - Enter search query
   - Browse results

4. **Set Up Automated Scraping:**
   - Configure `SCRAPE_INTERVAL_HOURS` in `.env`
   - Restart backend to apply changes
   - Scraping will run automatically

---

## Support

If you encounter issues:

1. Check container logs: `docker-compose logs backend`
2. Verify health endpoint: `curl http://localhost:8000/api/health`
3. Review troubleshooting section above
4. Check GitHub issues for similar problems
5. Open a new issue with detailed logs

---

## Legal Notice

This tool is for **personal use only**. You are responsible for compliance with each service's Terms of Service. See main README.md for full disclaimer.
