/**
 * Background Service Worker
 * Handles automatic syncing on a schedule
 */

const API_BASE = 'http://localhost:8000';
const SYNC_INTERVAL = 2; // hours

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Chat History Sync installed');

  // Set default settings
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

  // Schedule automatic syncing
  if (settings.autoSync) {
    scheduleSync(settings.syncInterval);
  }
});

// Schedule periodic sync
function scheduleSync(intervalHours) {
  chrome.alarms.clear('autoSync');
  chrome.alarms.create('autoSync', {
    periodInMinutes: intervalHours * 60
  });
  console.log(`Auto-sync scheduled every ${intervalHours} hours`);
}

// Handle alarm triggers
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoSync') {
    console.log('Auto-sync triggered');
    await performAutoSync();
  }
});

// Perform automatic sync across all open tabs
async function performAutoSync() {
  const settings = await chrome.storage.sync.get(['enabledServices']);
  const enabled = settings.enabledServices || {};

  // Get all tabs with supported services
  const tabs = await chrome.tabs.query({ url: [
    'https://claude.ai/*',
    'https://chat.openai.com/*',
    'https://gemini.google.com/*'
  ]});

  for (const tab of tabs) {
    const service = detectService(tab.url);
    if (service && enabled[service]) {
      console.log(`Triggering sync for ${service} in tab ${tab.id}`);
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'sync' });
      } catch (error) {
        console.error(`Failed to sync ${service}:`, error);
      }
    }
  }

  // If no tabs open, log it
  if (tabs.length === 0) {
    console.log('No supported service tabs open for auto-sync');
  }
}

// Detect which service from URL
function detectService(url) {
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('chat.openai.com')) return 'chatgpt';
  if (url.includes('gemini.google.com')) return 'gemini';
  return null;
}

// Single unified message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Message received:', request.action);

  // Handle syncComplete from content scripts
  if (request.action === 'syncComplete') {
    console.log(`Sync complete for ${request.service}:`, request.result);
    chrome.storage.local.set({
      [`lastSync_${request.service}`]: Date.now()
    });
    return false; // Synchronous, no response needed
  }

  // Handle syncError from content scripts
  if (request.action === 'syncError') {
    console.error(`Sync error for ${request.service}:`, request.error);
    return false; // Synchronous, no response needed
  }

  // Handle manual sync from popup
  if (request.action === 'manualSync') {
    performAutoSync().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  }

  // Handle triggerSyncAll from popup
  if (request.action === 'triggerSyncAll') {
    console.log('[Background] triggerSyncAll received');

    // Determine which service to sync based on active tab
    (async () => {
      try {
        // Get active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('[Background] Active tab URL:', activeTab?.url);

        const service = detectService(activeTab?.url);
        console.log('[Background] Detected service:', service);

        // Define service-specific configurations
        const serviceConfig = {
          'claude': {
            url: 'https://claude.ai/*',
            scripts: ['auto-logger.js', 'content-scripts/claude-api.js', 'content-scripts/claude.js']
          },
          'gemini': {
            url: 'https://gemini.google.com/*',
            scripts: ['content-scripts/gemini-api.js', 'content-scripts/gemini.js']
          }
        };

        // Default to Claude if no specific service detected
        const targetService = service || 'claude';
        const config = serviceConfig[targetService];

        if (!config) {
          console.error('[Background] Unsupported service:', targetService);
          return;
        }

        // Find tabs for the target service
        const tabs = await chrome.tabs.query({ url: config.url });
        console.log(`[Background] Found ${tabs.length} ${targetService} tabs`);

        if (tabs.length === 0) {
          console.error(`[Background] No ${targetService} tabs open`);
          return;
        }

        const tab = tabs[0];
        console.log('[Background] Using tab:', tab.id, tab.url);

        // Test if content script is loaded
        let contentScriptReady = false;
        try {
          const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
          console.log('[Background] Content script ping response:', pingResponse);
          contentScriptReady = true;
        } catch (pingError) {
          console.log('[Background] Content script not loaded, injecting...');

          // Inject content scripts
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: config.scripts
            });

            console.log('[Background] Scripts injected, waiting...');
            await new Promise(resolve => setTimeout(resolve, 500));

            // Test again
            const retryResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
            console.log('[Background] Content script now ready:', retryResponse);
            contentScriptReady = true;
          } catch (injectError) {
            console.error('[Background] Failed to inject scripts:', injectError);
            return;
          }
        }

        if (!contentScriptReady) {
          console.error('[Background] Content script not ready, aborting');
          return;
        }

        // Focus the tab
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        await new Promise(resolve => setTimeout(resolve, 300));

        // Send syncAll message
        console.log(`[Background] Sending syncAll message to ${targetService} tab ${tab.id}...`);
        chrome.tabs.sendMessage(tab.id, { action: 'syncAll' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`[Background] syncAll failed for ${targetService}:`, chrome.runtime.lastError);
          } else {
            console.log(`[Background] syncAll response from ${targetService}:`, response);
          }
        });

      } catch (error) {
        console.error('[Background] Error in triggerSyncAll:', error);
      }
    })();

    return false; // No response needed, popup can close immediately
  }

  return false; // No async response for unknown actions
});
