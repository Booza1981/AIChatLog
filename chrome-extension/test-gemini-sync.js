/**
 * Gemini Sync Debugger
 * Paste this into the Console on gemini.google.com to test if sync works
 */

console.log('=== GEMINI SYNC DEBUGGER ===');

// Test 1: Check if content scripts are loaded
console.log('\n1. Testing if content scripts loaded...');
if (typeof fetchAllConversationsViaAPI === 'function') {
    console.log('✓ gemini-api.js loaded');
} else {
    console.log('✗ gemini-api.js NOT loaded');
}

if (typeof performSyncAll === 'function') {
    console.log('✓ performSyncAll function exists');
} else {
    console.log('✗ performSyncAll function NOT found');
}

// Test 2: Test message listener
console.log('\n2. Testing message listener...');
chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
    if (chrome.runtime.lastError) {
        console.log('✗ Message failed:', chrome.runtime.lastError);
    } else {
        console.log('✓ Message listener working:', response);
    }
});

// Test 3: Manually trigger syncAll
console.log('\n3. Attempting to trigger syncAll manually...');
setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'syncAll' }, (response) => {
        if (chrome.runtime.lastError) {
            console.log('✗ syncAll failed:', chrome.runtime.lastError);
        } else {
            console.log('✓ syncAll triggered:', response);
        }
    });
}, 1000);

console.log('\n=== Wait for results above ===');
