/**
 * Minimal Gemini test script
 * This should appear in console if content scripts are loading
 */

console.log('🔴 GEMINI TEST SCRIPT LOADED! 🔴');
console.log('URL:', window.location.href);
console.log('chrome.runtime:', typeof chrome.runtime);

// Test basic extension API
if (typeof chrome !== 'undefined' && chrome.runtime) {
    console.log('✓ Chrome extension APIs available');
    console.log('Extension ID:', chrome.runtime.id);
} else {
    console.log('✗ Chrome extension APIs NOT available');
}
