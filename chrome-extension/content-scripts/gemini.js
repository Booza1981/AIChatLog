/**
 * Gemini Content Script
 * TODO: Implement Gemini-specific extraction
 */

const SERVICE = 'gemini';
const API_BASE = 'http://localhost:8000';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sync') {
    console.log('[Gemini] Sync not yet implemented');
    sendResponse({ success: false, error: 'Gemini sync not yet implemented' });
  }
  return true;
});

console.log('[Gemini] Content script loaded (not yet implemented)');
