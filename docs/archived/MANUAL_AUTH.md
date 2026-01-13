# Manual Authentication (Simple Method)

Since the VNC and backend containers can't easily share X11 displays, here's the simplest working authentication method.

## Step-by-Step Process

### 1. Export Cookies Manually

After logging into Claude.ai in the VNC browser:

1. **In the VNC browser (Firefox/Chromium), press F12** to open Developer Tools
2. **Go to the Console tab**
3. **Paste this JavaScript code and press Enter:**

```javascript
// Export cookies as JSON
const cookies = document.cookie.split(';').map(c => {
    const [name, value] = c.trim().split('=');
    return { name, value, domain: '.claude.ai', path: '/' };
});
console.log(JSON.stringify({cookies: cookies, origins: []}));
```

4. **Copy the entire JSON output** (it will be a long string starting with `{"cookies":[...`)

### 2. Save to Backend Container

On your **host machine**:

```bash
# Create the profile directory
mkdir -p volumes/browser-profiles/claude

# Create the state file with your cookies
# Replace THE_JSON_YOU_COPIED with the actual JSON from step 1
cat > volumes/browser-profiles/claude/state.json << 'EOF'
THE_JSON_YOU_COPIED
EOF
```

### 3. Test the Session

```bash
# Rebuild and restart backend
docker-compose restart backend

# Try to scrape
curl -X POST http://localhost:8000/api/scrape/claude
```

## Alternative: Use EditThisCookie Extension

Even simpler if you can install browser extensions in VNC:

1. Install "EditThisCookie" extension in the VNC browser
2. Navigate to claude.ai (logged in)
3. Click the extension icon
4. Export cookies as JSON
5. Save to `volumes/browser-profiles/claude/state.json` in the format:
```json
{
  "cookies": [...exported cookies...],
  "origins": []
}
```

## Verify It Works

```bash
# Check if session file exists
ls -lh volumes/browser-profiles/claude/state.json

# Should show a file with some size (e.g., 2-5KB)

# Test scraping
curl -X POST http://localhost:8000/api/scrape/claude

# Check the job status
curl http://localhost:8000/api/scrape/status/{job_id_from_above}
```

---

If this is too manual, I can modify the docker-compose to properly share the X11 display between containers.
