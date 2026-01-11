/**
 * Inspect Claude's internal API calls
 * Run this in Claude.ai console to see what APIs are used
 */

// Intercept fetch calls to see what Claude's API looks like
const originalFetch = window.fetch;
window.fetch = function(...args) {
  console.log('[API Call]', args[0]);
  return originalFetch.apply(this, args).then(response => {
    console.log('[API Response]', args[0], response.status);
    return response;
  });
};

console.log('API interceptor installed. Open a conversation to see API calls.');
console.log('Look for endpoints like /api/organizations/.../chat_conversations or similar');
