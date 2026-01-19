/**
 * Background Service Worker
 * Handles automatic syncing on a schedule
 */

const SYNC_INTERVAL = 2; // hours
const API_BASE_CANDIDATES = ['http://backend:8000', 'http://localhost:8000'];
const SERVICE_TABS = {
  claude: {
    url: 'https://claude.ai/chats',
    patterns: ['https://claude.ai/*']
  },
  chatgpt: {
    url: 'https://chatgpt.com/',
    patterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
  },
  gemini: {
    url: 'https://gemini.google.com/',
    patterns: ['https://gemini.google.com/*']
  }
};
const SERVICE_SCRIPTS = {
  claude: {
    url: 'https://claude.ai/*',
    scripts: ['auto-logger.js', 'content-scripts/claude-api.js', 'content-scripts/claude.js']
  },
  chatgpt: {
    url: 'https://chatgpt.com/*',
    scripts: ['chatgpt-sync-state-manager.js', 'content-scripts/chatgpt-api.js', 'content-scripts/chatgpt.js']
  },
  gemini: {
    url: 'https://gemini.google.com/*',
    scripts: ['content-scripts/gemini-api.js', 'content-scripts/gemini.js']
  }
};

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

async function fetchWithFallback(path, options) {
  const preferred = await getApiBase();
  const candidates = [preferred, ...API_BASE_CANDIDATES.filter(base => base !== preferred)];

  let lastError = null;
  for (const apiBase of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      try {
        const fetchOptions = { ...(options || {}), signal: controller.signal };
        const response = await fetch(`${apiBase}${path}`, fetchOptions);
        if (apiBase !== preferred) {
          await chrome.storage.sync.set({ apiBase });
        }
        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        lastError = new Error(`Timeout contacting ${apiBase}`);
      } else {
        lastError = new Error(`Fetch failed for ${apiBase}: ${error.message || error}`);
      }
    }
  }

  const message = lastError?.message ? `Failed to fetch: ${lastError.message}` : 'Failed to fetch';
  throw new Error(message);
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.sync.get({
    autoSync: true,
    autoOpenTabs: true,
    syncInterval: SYNC_INTERVAL,
    enabledServices: {
      claude: true,
      chatgpt: true,
      gemini: true
    }
  });

  await chrome.storage.sync.set(settings);
  await ensureApiBase();
  await ensureServiceTabs();

  if (settings.autoSync) {
    scheduleSync(settings.syncInterval);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureApiBase();
  await ensureServiceTabs();
});

// Schedule periodic sync
function scheduleSync(intervalHours) {
  chrome.alarms.clear('autoSync');
  chrome.alarms.create('autoSync', {
    periodInMinutes: intervalHours * 60
  });
}

async function ensureServiceTabs() {
  const settings = await chrome.storage.sync.get({
    autoOpenTabs: true,
    enabledServices: {
      claude: true,
      chatgpt: true,
      gemini: true
    }
  });

  if (!settings.autoOpenTabs) {
    return;
  }

  for (const [service, config] of Object.entries(SERVICE_TABS)) {
    if (!settings.enabledServices[service]) {
      continue;
    }

    const tabs = await chrome.tabs.query({ url: config.patterns });

    if (tabs.length === 0) {
      await chrome.tabs.create({ url: config.url });
    }
  }
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

  let triggered = 0;

  for (const tab of tabs) {
    const service = detectService(tab.url);
    if (service && enabled[service]) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'syncQuick' });
        triggered += 1;
      } catch (error) {
        // Tab may not have content script loaded
      }
    }
  }

  if (triggered === 0) {
    throw new Error('No enabled service tabs found to sync');
  }

  return { triggered };
}

// Detect which service from URL
function detectService(url) {
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) return 'chatgpt';
  if (url.includes('gemini.google.com')) return 'gemini';
  return null;
}

async function ensureContentScript(tabId, scripts) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch (pingError) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: scripts
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      return true;
    } catch (injectError) {
      return false;
    }
  }
}

async function triggerSyncAllForService(service) {
  const config = SERVICE_SCRIPTS[service];
  if (!config) {
    return false;
  }

  const tabs = await chrome.tabs.query({ url: config.url });
  if (tabs.length === 0) {
    return false;
  }

  const tab = tabs[0];
  const ready = await ensureContentScript(tab.id, config.scripts);
  if (!ready) {
    return false;
  }

  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await new Promise(resolve => setTimeout(resolve, 300));

  chrome.tabs.sendMessage(tab.id, { action: 'syncAll' });
  return true;
}

async function triggerSyncQuickForService(service) {
  const config = SERVICE_SCRIPTS[service];
  if (!config) {
    return false;
  }

  const tabs = await chrome.tabs.query({ url: config.url });
  if (tabs.length === 0) {
    return false;
  }

  const tab = tabs[0];
  const ready = await ensureContentScript(tab.id, config.scripts);
  if (!ready) {
    return false;
  }

  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await new Promise(resolve => setTimeout(resolve, 300));

  chrome.tabs.sendMessage(tab.id, { action: 'syncQuick' });
  return true;
}

// Single unified message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'apiFetch') {
    (async () => {
      try {
        const response = await fetchWithFallback(request.path, request.options);
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
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const service = detectService(activeTab?.url || '');
        if (!service) {
          throw new Error('Active tab is not a supported service');
        }
        await chrome.tabs.sendMessage(activeTab.id, { action: 'sync' });
        sendResponse({ success: true, service });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle triggerSyncAll from popup
  if (request.action === 'triggerSyncAll') {
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const service = detectService(activeTab?.url);
        const targetService = service || 'claude';
        await triggerSyncAllForService(targetService);
      } catch (error) {
        console.warn('[Background] triggerSyncAll error:', error.message);
      }
    })();

    return false;
  }

  // Handle triggerSyncAllEnabled from popup (all enabled services)
  if (request.action === 'triggerSyncAllEnabled') {
    (async () => {
      try {
        const settings = await chrome.storage.sync.get(['enabledServices']);
        const enabled = settings.enabledServices || {};
        for (const service of Object.keys(SERVICE_SCRIPTS)) {
          if (enabled[service]) {
            await triggerSyncAllForService(service);
          }
        }
      } catch (error) {
        console.warn('[Background] triggerSyncAllEnabled error:', error.message);
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
        const targetService = service || 'claude';
        await triggerSyncQuickForService(targetService);
      } catch (error) {
        console.warn('[Background] triggerSyncQuick error:', error.message);
      }
    })();

    return false;
  }

  return false;
});
