/**
 * Backend API configuration helper.
 * Default is localhost for dev; override via chrome.storage.sync apiBase.
 */

const DEFAULT_API_BASE = 'http://localhost:8000';
let cachedApiBase = null;

async function getApiBase() {
  if (cachedApiBase) {
    return cachedApiBase;
  }

  const result = await chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE });
  cachedApiBase = result.apiBase || DEFAULT_API_BASE;
  return cachedApiBase;
}

async function apiFetch(path, options = {}) {
  const base = await getApiBase();
  return fetch(`${base}${path}`, options);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.apiBase) {
    cachedApiBase = changes.apiBase.newValue || DEFAULT_API_BASE;
  }
});
