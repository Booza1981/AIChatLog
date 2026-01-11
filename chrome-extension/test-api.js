/**
 * Test script to discover Claude's internal API
 * Run this in the Claude.ai console to see what API endpoints are available
 */

// Intercept fetch requests
const originalFetch = window.fetch;
window.fetch = function(...args) {
  console.log('[API Call]', args[0], args[1]);
  return originalFetch.apply(this, args);
};

// Check for existing API calls in network tab
console.log('Watching for API calls... Open DevTools > Network tab and refresh the page');
console.log('Look for calls to /api/ endpoints');

// Try to find sessionKey or API credentials
console.log('Checking localStorage for API keys:');
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key.includes('session') || key.includes('token') || key.includes('auth')) {
    console.log(`  ${key}:`, localStorage.getItem(key).substring(0, 50) + '...');
  }
}

// Try a common Claude API endpoint
async function testClaudeAPI() {
  try {
    // This is Claude's organization list endpoint
    const response = await fetch('https://claude.ai/api/organizations', {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Organizations API works!', data);

      // Now try to get conversations
      if (data.length > 0) {
        const orgId = data[0].uuid;
        const convsResponse = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations`, {
          credentials: 'include'
        });

        if (convsResponse.ok) {
          const convs = await convsResponse.json();
          console.log('Conversations API works!', convs);
          console.log(`Found ${convs.length} conversations via API!`);
        }
      }
    }
  } catch (error) {
    console.error('API test failed:', error);
  }
}

testClaudeAPI();
