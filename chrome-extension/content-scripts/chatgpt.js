/**
 * ChatGPT Content Script
 * TODO: Implement ChatGPT-specific extraction
 */

const SERVICE = 'chatgpt';
const API_BASE = 'http://localhost:8000';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sync') {
    console.log('[ChatGPT] Sync not yet implemented');
    sendResponse({ success: false, error: 'ChatGPT sync not yet implemented' });
  }
  return true;
});

console.log('[ChatGPT] Content script loaded (not yet implemented)');
