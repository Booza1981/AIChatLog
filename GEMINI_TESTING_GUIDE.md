# Gemini Sync All - Testing Guide

## What We've Implemented

✅ **Fixed SVG noise** - Cleaned up text extraction
✅ **Gemini API client** - Calls batchexecute endpoints
✅ **Sync All functionality** - Similar to Claude's approach
✅ **Background script** - Auto-detects which service to sync

## How to Test

### Step 1: Reload Extension

1. Go to `chrome://extensions/`
2. Find "Chat History Sync"
3. Click **Reload** button (🔄 icon)

### Step 2: Open Gemini Console for Debugging

1. Open Gemini: https://gemini.google.com
2. Press `F12` to open DevTools
3. Go to **Console** tab
4. Keep this open to see logs

### Step 3: Test "Sync Current" First

1. Open any Gemini conversation
2. Click extension icon
3. Click **"Sync Current"**
4. Watch console for logs:
   - `[Gemini] Starting conversation sync...`
   - `[Gemini] Extracted X messages`
   - `✓ Gemini conversation synced` (notification)
5. **Check console** - should NOT see SVG/icon text anymore
6. **Verify in frontend**: http://localhost:3000

### Step 4: Test "Sync All" (Main Feature)

1. Make sure you're on a Gemini tab
2. Click extension icon
3. Click **"Sync All Conversations"**
4. Dialog will ask for confirmation - click **OK**
5. Watch console for these logs:

```
[Gemini] ========== performSyncAll() CALLED (API MODE) ==========
[Gemini API] Fetching all conversations...
[Gemini API] Requesting: https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=MaZiqc...
[Gemini API] Raw response: (starts with )]}')
[Gemini API] Parsed response: [...]
[Gemini] Parsed X conversations
[Gemini] Syncing 1/X: {conversation title}
```

6. **Progress notification** should appear in top-right
7. Watch it sync each conversation
8. Final notification: `✓ Synced X/Y conversations!`

### Step 5: Inspect API Responses

The first time you run "Sync All", the API responses will be logged. We need to check if the parsing is correct:

**In console, look for:**
```
[Gemini API] Parsed data: [...]
```

**Copy this data and examine it:**
- Does it contain conversation IDs?
- Does it contain conversation titles?
- What is the structure?

**Then look for:**
```
[Gemini] Converting API data to DB format: [...]
```

**Check:**
- Are messages being extracted?
- Are they in the right format?

### Expected Issues & Fixes

#### Issue 1: "Could not parse conversation list"

**Cause:** The batchexecute response structure is different than expected.

**Fix:**
1. Copy the logged `[Gemini API] Parsed data` from console
2. Examine the structure
3. Update `performSyncAll()` in gemini.js:
   - Look at lines 353-363
   - Adjust how we extract conversations from the response

#### Issue 2: "Unknown data structure" for conversation messages

**Cause:** The message format is different than expected.

**Fix:**
1. Copy the logged `[Gemini] Converting API data` from console
2. Examine message structure
3. Update `convertGeminiAPIToDBFormat()` in gemini.js:
   - Look at lines 470-520
   - Adjust how we extract messages

#### Issue 3: Request parameters are wrong

**Cause:** The `bl` (build version) or other params are outdated.

**Fix:**
1. Open Network tab in DevTools
2. Click a conversation
3. Find the batchexecute call
4. Copy the actual parameters (bl, f.sid, etc.)
5. Update `getSessionParams()` in gemini-api.js

## Debug Tools

### Test API Call Manually

Open console on Gemini and run:
```javascript
// Test fetching conversation list
fetchAllConversationsViaAPI()
  .then(data => console.log('SUCCESS:', data))
  .catch(err => console.error('ERROR:', err));
```

### Test Single Conversation

```javascript
// Replace 'conv-id-here' with actual conversation ID from URL
fetchConversationMessages('conv-id-here')
  .then(data => console.log('CONVERSATION:', data))
  .catch(err => console.error('ERROR:', err));
```

### Inspect Network Requests

Use the inspector tool we created:
```javascript
// This will log all batchexecute calls
// (Already loaded if you open inspect-gemini-api.js in console)
inspectGeminiAPI();
```

Then click around Gemini UI and watch the logs.

## What to Report Back

After testing, please report:

1. **Did "Sync Current" work?**
   - Yes/No
   - Any SVG noise remaining?

2. **Did "Sync All" start?**
   - Yes/No
   - Any error messages?

3. **Console logs** - Copy and paste these:
   ```
   [Gemini API] Parsed data: ...
   [Gemini] Converting API data to DB format: ...
   ```

4. **How many conversations synced?**
   - Expected: X
   - Actually synced: Y

5. **Data quality**
   - Are titles correct?
   - Are messages complete?
   - Any formatting issues?

## Quick Fixes

### If API calls fail completely

The `bl` parameter might be outdated. To fix:

1. Open Network tab
2. Find a real batchexecute call
3. Copy the `bl` parameter value
4. Update line 71 in `gemini-api.js`:
   ```javascript
   'bl': 'YOUR_NEW_BL_VALUE_HERE',
   ```

### If conversations aren't being parsed

The response structure is different. We'll need to see the actual response to fix it. Just run the test and share the console logs!

---

**Ready to test?**
1. Reload extension
2. Open Gemini
3. Open console (F12)
4. Click "Sync All"
5. Report back what you see! 🚀
