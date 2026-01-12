/**
 * Gemini Token Helper - Runs in MAIN world (page context)
 * This script has access to the real window object
 */

// Store the captured token
window.__geminiToken__ = null;

/**
 * Manually set the Gemini session token
 * Usage in console: window.setGeminiToken("long-token-here")
 */
window.setGeminiToken = function(token) {
  window.__geminiToken__ = token;
  console.log('[Gemini Token Helper] ✓ Token set successfully');
  console.log('[Gemini Token Helper] Token length:', token.length);
  console.log('[Gemini Token Helper] Token preview:', token.substring(0, 50) + '...');

  // Dispatch event to notify content script
  window.dispatchEvent(new CustomEvent('geminiTokenSet', { detail: token }));
};

/**
 * Get the stored token
 */
window.getGeminiToken = function() {
  return window.__geminiToken__;
};

console.log('[Gemini Token Helper] 🔧 Helper loaded in MAIN world');
console.log('[Gemini Token Helper] Usage: window.setGeminiToken("your-long-token-here")');
