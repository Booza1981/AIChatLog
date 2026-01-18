/**
 * Background Service Worker
 * Handles automatic syncing on a schedule
 */

const SYNC_INTERVAL = 2; // hours
const API_BASE_CANDIDATES = ['http://backend:8000', 'http://localhost:8000'];

async function isApiHealthy(apiBase) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(`${apiBase}/api/health`, { signal: controller.signal });
    return response.ok;
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureApiBase() {
  const result = await chrome.storage.sync.get(['apiBase']);
  if (result.apiBase) {
    return;
  }

  for (const apiBase of API_BASE_CANDIDATES) {
    if (await isApiHealthy(apiBase)) {
      await chrome.storage.sync.set({ apiBase });
      return;
    }
  }
}

async function getApiBase() {
  const result = await chrome.storage.sync.get(['apiBase']);
  if (result.apiBase) {
    return result.apiBase;
  }

  await ensureApiBase();
  const updated = await chrome.storage.sync.get({ apiBase: 'http://localhost:8000' });
  return updated.apiBase || 'http://localhost:8000';
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.sync.get({
    autoSync: true,
    syncInterval: SYNC_INTERVAL,
    enabledServices: {
      claude: true,
      chatgpt: true,
      gemini: true
    }
  });

  await chrome.storage.sync.set(settings);
  await ensureApiBase();

  if (settings.autoSync) {
    scheduleSync(settings.syncInterval);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureApiBase();
});

// Schedule periodic sync
function scheduleSync(intervalHours) {
  chrome.alarms.clear('autoSync');
  chrome.alarms.create('autoSync', {
    periodInMinutes: intervalHours * 60
  });
}

// Handle alarm triggers
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoSync') {
    await performAutoSync();
  }
});

// Perform automatic sync across all open tabs (uses incremental Quick Sync)
async function performAutoSync() {
  const settings = await chrome.storage.sync.get(['enabledServices']);
  const enabled = settings.enabledServices || {};

  const tabs = await chrome.tabs.query({ url: [
    'https://claude.ai/*',
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
    'https://gemini.google.com/*'
  ]});

  for (const tab of tabs) {
    const service = detectService(tab.url);
    if (service && enabled[service]) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'syncQuick' });
      } catch (error) {
        // Tab may not have content script loaded
      }
    }
  }
}

// Detect which service from URL
function detectService(url) {
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) return 'chatgpt';
  if (url.includes('gemini.google.com')) return 'gemini';
  return null;
}

// Single unified message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'apiFetch') {
    (async () => {
      try {
        const apiBase = await getApiBase();
        const response = await fetch(`${apiBase}${request.path}`, request.options || {});
        const body = await response.text();
        const headers = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        sendResponse({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers,
          body
        });
      } catch (error) {
        sendResponse({ error: error.message || String(error) });
      }
    })();
    return true;
  }

  // Handle syncComplete from content scripts
  if (request.action === 'syncComplete') {
    chrome.storage.local.set({
      [`lastSync_${request.service}`]: Date.now()
    });
    return false;
  }

  // Handle syncError from content scripts
  if (request.action === 'syncError') {
    return false;
  }

  // Handle manual sync from popup
  if (request.action === 'manualSync') {
    performAutoSync().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Handle triggerSyncAll from popup
  if (request.action === 'triggerSyncAll') {
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const service = detectService(activeTab?.url);

        const serviceConfig = {
          'claude': {
            url: 'https://claude.ai/*',
            scripts: ['auto-logger.js', 'content-scripts/claude-api.js', 'content-scripts/claude.js']
          },
          'chatgpt': {
            url: 'https://chatgpt.com/*',
            scripts: ['chatgpt-sync-state-manager.js', 'content-scripts/chatgpt-api.js', 'content-scripts/chatgpt.js']
          },
          'gemini': {
            url: 'https://gemini.google.com/*',
            scripts: ['content-scripts/gemini-api.js', 'content-scripts/gemini.js']
          }
        };

        const targetService = service || 'claude';
        const config = serviceConfig[targetService];
        if (!config) return;

        const tabs = await chrome.tabs.query({ url: config.url });
        if (tabs.length === 0) return;

        const tab = tabs[0];
        let contentScriptReady = false;

        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
          contentScriptReady = true;
        } catch (pingError) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: config.scripts
            });
            await new Promise(resolve => setTimeout(resolve, 500));
            await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
            contentScriptReady = true;
          } catch (injectError) {
            return;
          }
        }

        if (!contentScriptReady) return;

        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        await new Promise(resolve => setTimeout(resolve, 300));

        chrome.tabs.sendMessage(tab.id, { action: 'syncAll' });
      } catch (error) {
        console.warn('[Background] triggerSyncAll error:', error.message);
      }
    })();

    return false;
  }

  // Handle triggerSyncQuick from popup (incremental sync)
  if (request.action === 'triggerSyncQuick') {
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const service = detectService(activeTab?.url);

        const serviceConfig = {
          'claude': {
            url: 'https://claude.ai/*',
            scripts: ['auto-logger.js', 'content-scripts/claude-api.js', 'content-scripts/claude.js']
          },
          'chatgpt': {
            url: 'https://chatgpt.com/*',
            scripts: ['chatgpt-sync-state-manager.js', 'content-scripts/chatgpt-api.js', 'content-scripts/chatgpt.js']
          },
          'gemini': {
            url: 'https://gemini.google.com/*',
            scripts: ['content-scripts/gemini-api.js', 'content-scripts/gemini.js']
          }
        };

        const targetService = service || 'claude';
        const config = serviceConfig[targetService];
        if (!config) return;

        const tabs = await chrome.tabs.query({ url: config.url });
        if (tabs.length === 0) return;

        const tab = tabs[0];
        let contentScriptReady = false;

        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
          contentScriptReady = true;
        } catch (pingError) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: config.scripts
            });
            await new Promise(resolve => setTimeout(resolve, 500));
            await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
            contentScriptReady = true;
          } catch (injectError) {
            return;
          }
        }

        if (!contentScriptReady) return;

        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        await new Promise(resolve => setTimeout(resolve, 300));

        chrome.tabs.sendMessage(tab.id, { action: 'syncQuick' });
      } catch (error) {
        console.warn('[Background] triggerSyncQuick error:', error.message);
      }
    })();

    return false;
  }

  return false;
});
