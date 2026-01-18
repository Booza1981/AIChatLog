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
  if (chrome?.runtime?.sendMessage) {
    const response = await chrome.runtime.sendMessage({
      action: 'apiFetch',
      path,
      options
    });

    if (!response) {
      throw new Error('No response from background fetch');
    }

    if (response.error) {
      throw new Error(response.error);
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers || {}),
      json: async () => JSON.parse(response.body || ''),
      text: async () => response.body || ''
    };
  }

  const base = await getApiBase();
  return fetch(`${base}${path}`, options);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.apiBase) {
    cachedApiBase = changes.apiBase.newValue || DEFAULT_API_BASE;
  }
});
