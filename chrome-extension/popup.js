/**
 * Popup UI Controller
 */

// Load settings on popup open
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadLastSyncTimes();
  setupEventListeners();
});

// Load user settings
async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    autoSync: true,
    syncInterval: 2,
    enabledServices: {
      claude: true,
      chatgpt: true,
      gemini: false
    }
  });

  // Set toggle states
  document.querySelectorAll('.service-toggle').forEach(toggle => {
    const service = toggle.getAttribute('data-service');
    if (settings.enabledServices[service]) {
      toggle.classList.add('active');
    }
  });

  // Set sync interval
  document.getElementById('syncInterval').value = settings.syncInterval;
}

// Load last sync times for each service
async function loadLastSyncTimes() {
  const services = ['claude', 'chatgpt', 'gemini'];

  for (const service of services) {
    const result = await chrome.storage.local.get([`lastSync_${service}`]);
    const lastSync = result[`lastSync_${service}`];

    const statusEl = document.getElementById(`${service}-status`);
    if (lastSync) {
      const timeSince = getTimeSince(lastSync);
      statusEl.textContent = `Synced ${timeSince} ago`;
    }
  }
}

// Setup event listeners
function setupEventListeners() {
  const syncNowBtn = document.getElementById('syncNow');
  if (syncNowBtn) syncNowBtn.addEventListener('click', handleSyncNow);

  const syncQuickBtn = document.getElementById('syncQuick');
  if (syncQuickBtn) syncQuickBtn.addEventListener('click', handleSyncQuick);

  const syncAllBtn = document.getElementById('syncAll');
  if (syncAllBtn) syncAllBtn.addEventListener('click', handleSyncAll);

  document.querySelectorAll('.service-toggle').forEach(toggle => {
    toggle.addEventListener('click', handleToggleService);
  });

  document.getElementById('syncInterval').addEventListener('change', handleIntervalChange);
}

// Handle manual sync
async function handleSyncNow() {
  const button = document.getElementById('syncNow');
  const statusDiv = document.getElementById('status');

  button.disabled = true;
  button.textContent = 'Syncing...';
  statusDiv.style.display = 'none';

  try {
    // Send message to background script to trigger sync
    const response = await chrome.runtime.sendMessage({ action: 'manualSync' });

    if (response.success) {
      const service = response.service ? response.service.toUpperCase() : 'current tab';
      showStatus(`✓ Sync started for ${service}. Check in-page notifications.`, 'success');
      await loadLastSyncTimes();
    } else {
      throw new Error(response.error || 'Sync failed');
    }
  } catch (error) {
    showStatus('✗ Sync failed: ' + error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Sync Current';
  }
}

// Handle quick sync (incremental)
async function handleSyncQuick(event) {
  if (event) event.preventDefault();

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let serviceName = 'Claude';
  if (activeTab.url.includes('gemini.google.com')) {
    serviceName = 'Gemini';
  } else if (activeTab.url.includes('chatgpt.com') || activeTab.url.includes('chat.openai.com')) {
    serviceName = 'ChatGPT';
  }

  const confirmed = confirm(`Quick Sync will check all ${serviceName} conversations and only sync new or updated ones.\n\nThis is much faster than "Sync All". Continue?`);
  if (!confirmed) return;

  chrome.runtime.sendMessage({ action: 'triggerSyncQuick' });
  showStatus('✓ Starting quick sync...', 'success');
  setTimeout(() => window.close(), 500);
}

// Handle sync all conversations
async function handleSyncAll(event) {
  if (event) event.preventDefault();

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let serviceName = 'Claude';
  if (activeTab.url.includes('gemini.google.com')) {
    serviceName = 'Gemini';
  } else if (activeTab.url.includes('chatgpt.com') || activeTab.url.includes('chat.openai.com')) {
    serviceName = 'ChatGPT';
  }

  const confirmed = confirm(`This will sync ALL conversations from ${serviceName}.\n\nThis may take several minutes. Continue?`);
  if (!confirmed) return;

  chrome.runtime.sendMessage({ action: 'triggerSyncAll' });
  showStatus('✓ Starting sync...', 'success');
  setTimeout(() => window.close(), 500);
}

// Handle service toggle
async function handleToggleService(event) {
  const toggle = event.currentTarget;
  const service = toggle.getAttribute('data-service');
  const isActive = toggle.classList.contains('active');

  // Toggle state
  if (isActive) {
    toggle.classList.remove('active');
  } else {
    toggle.classList.add('active');
  }

  // Save to storage
  const settings = await chrome.storage.sync.get(['enabledServices']);
  settings.enabledServices[service] = !isActive;
  await chrome.storage.sync.set({ enabledServices: settings.enabledServices });
}

// Handle sync interval change
async function handleIntervalChange(event) {
  const interval = parseInt(event.target.value);
  await chrome.storage.sync.set({ syncInterval: interval });

  // Update alarm schedule
  chrome.runtime.sendMessage({
    action: 'updateSchedule',
    interval: interval
  });
}

// Show status message
function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';

  // Hide after 3 seconds
  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 3000);
}

// Get human-readable time since
function getTimeSince(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'just now';
}
